import { SYSTEM_THRESHOLD_POLICY } from '../threshold-policy';
import { ThresholdStateSnapshot } from '../threshold.types';
import { AllocationDriftRule } from './allocation-drift.rule';

/**
 * Banda de 2pp e cooldown de 72h (defaults do sistema). Zona morta da
 * histerese = 1pp (metade da banda).
 */
const policy = SYSTEM_THRESHOLD_POLICY;
const rule = new AllocationDriftRule();

const T0 = new Date('2026-09-01T10:00:00.000Z');
const horas = (n: number) => new Date(T0.getTime() + n * 60 * 60 * 1000);

const estado = (
	over: Partial<ThresholdStateSnapshot> = {}
): ThresholdStateSnapshot => ({
	breaching: false,
	referenceValue: 0,
	lastNotifiedAt: null,
	lastEvaluatedAt: T0.toISOString(),
	...over,
});

describe('AllocationDriftRule (TRA-136 fase 4)', () => {
	it('30% de meta com 30,4% real fica dentro da banda e nao notifica', () => {
		const d = rule.evaluate(
			{ bucket: 'crypto', targetPct: 30, actualPct: 30.4 },
			null,
			policy,
			T0
		);

		expect(d.outcome).toBe('suppressed_inside_band');
		expect(d.shouldNotify).toBe(false);
	});

	it('SAIR da banda notifica (borda de subida)', () => {
		const d = rule.evaluate(
			{ bucket: 'crypto', targetPct: 30, actualPct: 33 },
			null,
			policy,
			T0
		);

		expect(d.outcome).toBe('notify');
		expect(d.shouldNotify).toBe(true);
		expect(d.nextState).toMatchObject({
			breaching: true,
			lastNotifiedAt: T0.toISOString(),
		});
		expect(d.metrics.deviationPp).toBe(3);
	});

	it('CONTINUAR fora da banda nao notifica de novo dentro do cooldown', () => {
		const anterior = estado({
			breaching: true,
			referenceValue: 3,
			lastNotifiedAt: T0.toISOString(),
		});

		const d = rule.evaluate(
			{ bucket: 'crypto', targetPct: 30, actualPct: 34 },
			anterior,
			policy,
			horas(24)
		);

		expect(d.outcome).toBe('suppressed_standing');
		expect(d.shouldNotify).toBe(false);
		// O relogio do cooldown NAO reinicia a cada avaliacao suprimida.
		expect(d.nextState?.lastNotifiedAt).toBe(T0.toISOString());
	});

	it('re-arma por cooldown quando a condicao fica de pe alem de 72h', () => {
		const anterior = estado({
			breaching: true,
			referenceValue: 3,
			lastNotifiedAt: T0.toISOString(),
		});

		const d = rule.evaluate(
			{ bucket: 'crypto', targetPct: 30, actualPct: 34 },
			anterior,
			policy,
			horas(72)
		);

		expect(d.outcome).toBe('notify');
		expect(d.reason).toContain('cooldown');
		expect(d.nextState?.lastNotifiedAt).toBe(horas(72).toISOString());
	});

	it('VOLTAR para dentro da banda desarma e NAO notifica', () => {
		const anterior = estado({
			breaching: true,
			referenceValue: 3,
			lastNotifiedAt: T0.toISOString(),
		});

		const d = rule.evaluate(
			{ bucket: 'crypto', targetPct: 30, actualPct: 30.5 },
			anterior,
			policy,
			horas(10)
		);

		expect(d.outcome).toBe('cleared');
		expect(d.shouldNotify).toBe(false);
		expect(d.nextState).toMatchObject({
			breaching: false,
			lastNotifiedAt: null,
		});
	});

	it('desarmado, uma nova saida da banda volta a ser borda de subida', () => {
		const desarmado = estado({ breaching: false, lastNotifiedAt: null });

		const d = rule.evaluate(
			{ bucket: 'crypto', targetPct: 30, actualPct: 33 },
			desarmado,
			policy,
			horas(11)
		);

		expect(d.outcome).toBe('notify');
		expect(d.reason).toContain('borda de subida');
	});

	it('encostar na banda por baixo nao desarma (zona morta da histerese)', () => {
		const anterior = estado({
			breaching: true,
			referenceValue: 3,
			lastNotifiedAt: T0.toISOString(),
		});

		// 1,8pp: abaixo da banda (2pp) mas acima da liberacao (1pp).
		const d = rule.evaluate(
			{ bucket: 'crypto', targetPct: 30, actualPct: 31.8 },
			anterior,
			policy,
			horas(5)
		);

		expect(d.outcome).toBe('suppressed_standing');
		expect(d.nextState?.breaching).toBe(true);
	});

	it('desvio para BAIXO da meta tambem conta', () => {
		const d = rule.evaluate(
			{ bucket: 'fiis', targetPct: 20, actualPct: 12 },
			null,
			policy,
			T0
		);

		expect(d.outcome).toBe('notify');
		expect(d.metrics.deviationPp).toBe(-8);
	});

	it('cada balde arma e desarma no proprio escopo', () => {
		expect(rule.scopeOf({ bucket: 'fiis', targetPct: 1, actualPct: 1 })).toBe(
			'fiis'
		);
		expect(rule.scopeOf({ bucket: 'crypto', targetPct: 1, actualPct: 1 })).toBe(
			'crypto'
		);
	});

	it('banda maior configurada pelo usuario silencia o mesmo desvio', () => {
		const frouxa = { ...policy, allocationDriftBandPp: 10 };

		const d = rule.evaluate(
			{ bucket: 'crypto', targetPct: 30, actualPct: 33 },
			null,
			frouxa,
			T0
		);

		expect(d.shouldNotify).toBe(false);
	});

	it('leitura sem numero e descartada sem gravar estado', () => {
		const d = rule.evaluate(
			{ bucket: 'crypto', targetPct: Number.NaN, actualPct: 33 },
			null,
			policy,
			T0
		);

		expect(d.outcome).toBe('invalid');
		expect(d.nextState).toBeNull();
	});

	it('a evidencia carrega so numeros calculados aqui', () => {
		const d = rule.evaluate(
			{ bucket: 'crypto', targetPct: 30, actualPct: 33 },
			null,
			policy,
			T0
		);

		expect(d.evidence.map((e) => e.source)).toEqual([
			'allocation.bucket',
			'allocation.targetPct',
			'allocation.actualPct',
			'allocation.deviationPp',
			'threshold.allocationDriftBandPp',
		]);
	});
});
