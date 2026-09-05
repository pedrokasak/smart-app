import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from 'src/events/domain/domain-event';
import {
	AllocationBreachedPayload,
	PortfolioScoreEvaluatedPayload,
	isDomainEventType,
} from 'src/events/domain/event-types';
import { AllocationDriftRule } from 'src/thresholds/domain/rules/allocation-drift.rule';
import { PortfolioScoreDropRule } from 'src/thresholds/domain/rules/portfolio-score-drop.rule';
import { resolveThresholdPolicy } from 'src/thresholds/domain/threshold-policy';
import { THRESHOLD_ROUTING } from 'src/thresholds/domain/threshold-routing';
import {
	ResolvedThresholdPolicy,
	THRESHOLD_RULE_IDS,
	ThresholdDecision,
	ThresholdStateKey,
} from 'src/thresholds/domain/threshold.types';
import {
	THRESHOLD_POLICY_STORE,
	THRESHOLD_SYSTEM_POLICY,
	ThresholdPolicyStore,
} from './ports/threshold-policy.port';
import {
	THRESHOLD_STATE_STORE,
	ThresholdStateStore,
} from './ports/threshold-state.port';

/**
 * Orquestracao do motor de limiares (TRA-136, fase 4).
 *
 * Fica ENTRE o consumidor da fila e o `NotificationsService`: recebe o
 * envelope cru, carrega a leitura anterior, resolve a politica efetiva do
 * usuario, roda a regra pura e grava o estado seguinte. Nao notifica nada —
 * so devolve a decisao. Manter o disparo fora daqui e o que permite testar
 * o motor inteiro sem canal, sem Mongo e sem fila.
 *
 * Nunca lanca: uma decisao que explode viraria retry de fila e, ao fim,
 * dead-letter, para um evento que talvez nem merecesse notificacao. Falha
 * na leitura/gravacao do estado degrada para "deixa passar" — perder o
 * silencio e menos grave que perder o aviso.
 */
@Injectable()
export class ThresholdEngineService {
	private readonly logger = new Logger(ThresholdEngineService.name);

	private readonly allocationRule = new AllocationDriftRule();
	private readonly scoreRule = new PortfolioScoreDropRule();

	constructor(
		@Inject(THRESHOLD_STATE_STORE)
		private readonly stateStore: ThresholdStateStore,
		@Inject(THRESHOLD_POLICY_STORE)
		private readonly policyStore: ThresholdPolicyStore,
		@Inject(THRESHOLD_SYSTEM_POLICY)
		private readonly systemPolicy: ResolvedThresholdPolicy
	) {}

	async decide(
		event: DomainEvent,
		now: Date = new Date()
	): Promise<ThresholdDecision> {
		if (!isDomainEventType(event.type)) {
			return passThrough('tipo fora do registro de eventos de dominio');
		}

		const routing = THRESHOLD_ROUTING[event.type];
		if (routing.kind === 'discrete') {
			// Explicito, nunca por omissao: ver `threshold-routing.ts`.
			return passThrough(routing.why);
		}

		const userId = event.subject;
		if (!userId) {
			return passThrough('evento sem subject — sem estado por usuario');
		}

		try {
			const policy = resolveThresholdPolicy(
				await this.policyStore.findByUser(userId),
				this.systemPolicy
			);

			const decision = await this.runRule(event, routing.ruleId, policy, now);

			if (decision.ruleId && decision.nextState) {
				await this.stateStore.save(
					{ userId, ruleId: decision.ruleId, scope: decision.scope },
					decision.nextState
				);
			}

			this.logger.debug(
				`[${event.type}] user=${userId} scope=${decision.scope} -> ${decision.outcome}: ${decision.reason}`
			);

			return decision;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(
				`Motor de limiares falhou em ${event.type} (user=${userId}): ${message} — evento liberado`
			);
			return passThrough(`falha no motor de limiares: ${message}`);
		}
	}

	private async runRule(
		event: DomainEvent,
		ruleId: (typeof THRESHOLD_RULE_IDS)[keyof typeof THRESHOLD_RULE_IDS],
		policy: ResolvedThresholdPolicy,
		now: Date
	): Promise<ThresholdDecision> {
		const userId = event.subject;

		if (ruleId === THRESHOLD_RULE_IDS.AllocationDrift) {
			const payload = (event.payload ?? {}) as AllocationBreachedPayload;
			const input = {
				bucket: String(payload.bucket ?? ''),
				targetPct: Number(payload.targetPct),
				actualPct: Number(payload.actualPct),
			};
			const previous = await this.stateStore.load(
				key(userId, ruleId, this.allocationRule.scopeOf(input))
			);
			return this.allocationRule.evaluate(input, previous, policy, now);
		}

		const payload = (event.payload ?? {}) as PortfolioScoreEvaluatedPayload;
		const input = {
			score: Number(payload.score),
			maxScore: Number(payload.maxScore),
		};
		const previous = await this.stateStore.load(
			key(userId, ruleId, this.scoreRule.scopeOf())
		);
		return this.scoreRule.evaluate(input, previous, policy, now);
	}
}

function key(
	userId: string,
	ruleId: ThresholdStateKey['ruleId'],
	scope: string
): ThresholdStateKey {
	return { userId, ruleId, scope };
}

function passThrough(reason: string): ThresholdDecision {
	return {
		ruleId: null,
		scope: '',
		outcome: 'pass_through',
		reason,
		shouldNotify: true,
		nextState: null,
		evidence: [],
		metrics: {},
	};
}
