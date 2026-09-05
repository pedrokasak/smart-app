import { Logger } from '@nestjs/common';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { SYSTEM_THRESHOLD_POLICY } from 'src/thresholds/domain/threshold-policy';
import {
	THRESHOLD_RULE_IDS,
	ThresholdStateKey,
	ThresholdStateSnapshot,
} from 'src/thresholds/domain/threshold.types';
import { ThresholdPolicyStore } from './ports/threshold-policy.port';
import { ThresholdStateStore } from './ports/threshold-state.port';
import { ThresholdEngineService } from './threshold-engine.service';

const USER = '68b0e2f0c1a2b3d4e5f60011';
const T0 = new Date('2026-09-01T10:00:00.000Z');
const horas = (n: number) => new Date(T0.getTime() + n * 60 * 60 * 1000);

/**
 * Store em memoria. E o ponto do porto: a decisao inteira — borda,
 * histerese, cooldown, escopo — roda em teste sem Mongo.
 */
class InMemoryStateStore implements ThresholdStateStore {
	readonly data = new Map<string, ThresholdStateSnapshot>();

	private id(key: ThresholdStateKey) {
		return `${key.userId}|${key.ruleId}|${key.scope}`;
	}

	async load(key: ThresholdStateKey) {
		return this.data.get(this.id(key)) ?? null;
	}

	async save(key: ThresholdStateKey, state: ThresholdStateSnapshot) {
		this.data.set(this.id(key), state);
	}
}

const semPolitica: ThresholdPolicyStore = { findByUser: async () => null };

const alocacao = (
	bucket: 'stocks' | 'crypto' | 'fiis' | 'other',
	targetPct: number,
	actualPct: number
) =>
	createDomainEvent({
		type: DOMAIN_EVENT_TYPES.AllocationBreached,
		subject: USER,
		producer: 'test',
		payload: { bucket, targetPct, actualPct },
	});

const score = (value: number) =>
	createDomainEvent({
		type: DOMAIN_EVENT_TYPES.PortfolioScoreEvaluated,
		subject: USER,
		producer: 'test',
		payload: { score: value, maxScore: 100 },
	});

describe('ThresholdEngineService (TRA-136 fase 4)', () => {
	let store: InMemoryStateStore;
	let engine: ThresholdEngineService;

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		store = new InMemoryStateStore();
		engine = new ThresholdEngineService(
			store,
			semPolitica,
			SYSTEM_THRESHOLD_POLICY
		);
	});

	afterEach(() => jest.restoreAllMocks());

	it('uma condicao QUE PERMANECE so notifica na primeira avaliacao', async () => {
		// Cinco avaliacoes da MESMA carteira fora da meta dentro do cooldown
		// (0h, 12h, 24h, 36h, 48h). Antes da fase 4 seriam cinco e-mails.
		const resultados = [];
		for (const h of [0, 12, 24, 36, 48]) {
			resultados.push(
				await engine.decide(alocacao('crypto', 30, 35), horas(h))
			);
		}

		expect(resultados.map((r) => r.shouldNotify)).toEqual([
			true, // borda de subida
			false,
			false,
			false,
			false,
		]);
		expect(resultados.slice(1).map((r) => r.outcome)).toEqual(
			Array(4).fill('suppressed_standing')
		);
	});

	it('passadas 72h com a condicao de pe, notifica de novo — uma vez', async () => {
		expect(
			(await engine.decide(alocacao('crypto', 30, 35), T0)).shouldNotify
		).toBe(true);
		expect(
			(await engine.decide(alocacao('crypto', 30, 35), horas(71))).shouldNotify
		).toBe(false);
		expect(
			(await engine.decide(alocacao('crypto', 30, 35), horas(72))).shouldNotify
		).toBe(true);
		expect(
			(await engine.decide(alocacao('crypto', 30, 35), horas(73))).shouldNotify
		).toBe(false);
	});

	it('voltar a meta desarma; sair de novo volta a notificar', async () => {
		await engine.decide(alocacao('crypto', 30, 35), T0);

		const volta = await engine.decide(alocacao('crypto', 30, 30.2), horas(24));
		expect(volta.outcome).toBe('cleared');
		expect(volta.shouldNotify).toBe(false);

		const denovo = await engine.decide(alocacao('crypto', 30, 35), horas(48));
		expect(denovo.shouldNotify).toBe(true);
	});

	it('baldes diferentes tem estado independente', async () => {
		await engine.decide(alocacao('crypto', 30, 35), T0);

		const fiis = await engine.decide(alocacao('fiis', 20, 26), horas(1));
		expect(fiis.shouldNotify).toBe(true);

		expect([...store.data.keys()]).toEqual([
			`${USER}|${THRESHOLD_RULE_IDS.AllocationDrift}|crypto`,
			`${USER}|${THRESHOLD_RULE_IDS.AllocationDrift}|fiis`,
		]);
	});

	it('a politica do usuario vence o default do sistema', async () => {
		const comPolitica = new ThresholdEngineService(
			store,
			{ findByUser: async () => ({ allocationDriftBandPp: 10 }) },
			SYSTEM_THRESHOLD_POLICY
		);

		const d = await comPolitica.decide(alocacao('crypto', 30, 35), T0);
		expect(d.shouldNotify).toBe(false);
	});

	it('score: primeira leitura cala, queda de 10+ notifica, repeticao cala', async () => {
		expect((await engine.decide(score(80), T0)).shouldNotify).toBe(false);
		expect((await engine.decide(score(66), horas(24))).shouldNotify).toBe(true);
		expect((await engine.decide(score(65), horas(48))).shouldNotify).toBe(
			false
		);
	});

	it.each([
		[DOMAIN_EVENT_TYPES.DividendReceived, { symbol: 'PETR4', amount: 1 }],
		[
			DOMAIN_EVENT_TYPES.SubscriptionExpiring,
			{ planName: 'Pro', expiresAt: T0.toISOString(), daysUntilExpiration: 3 },
		],
		[
			DOMAIN_EVENT_TYPES.QuoteStale,
			{ symbol: 'PETR4', minutesSinceLastQuote: 90 },
		],
		[DOMAIN_EVENT_TYPES.AiInsightHighPriority, { title: 'x', summary: 'y' }],
	])('%s e discreto e passa direto, sem estado', async (type, payload) => {
		const d = await engine.decide(
			createDomainEvent({ type, subject: USER, producer: 'test', payload }),
			T0
		);

		expect(d.outcome).toBe('pass_through');
		expect(d.shouldNotify).toBe(true);
		expect(store.data.size).toBe(0);
	});

	it('falha do store libera o evento em vez de engolir a notificacao', async () => {
		const quebrado: ThresholdStateStore = {
			load: async () => {
				throw new Error('mongo fora');
			},
			save: async () => undefined,
		};

		const d = await new ThresholdEngineService(
			quebrado,
			semPolitica,
			SYSTEM_THRESHOLD_POLICY
		).decide(alocacao('crypto', 30, 35), T0);

		expect(d.outcome).toBe('pass_through');
		expect(d.shouldNotify).toBe(true);
	});

	it('evento sem subject passa direto (nao ha estado por usuario)', async () => {
		const evento = alocacao('crypto', 30, 35);
		const d = await engine.decide({ ...evento, subject: '' }, T0);

		expect(d.outcome).toBe('pass_through');
	});
});
