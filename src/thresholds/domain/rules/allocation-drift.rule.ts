import { RELEASE_BAND_FACTOR, decideEdge } from '../edge-trigger';
import {
	ResolvedThresholdPolicy,
	THRESHOLD_RULE_IDS,
	ThresholdDecision,
	ThresholdRule,
	ThresholdStateSnapshot,
} from '../threshold.types';

export interface AllocationDriftInput {
	bucket: string;
	targetPct: number;
	actualPct: number;
}

/**
 * Regra do desvio de alocacao (TRA-136, fase 4).
 *
 * Substitui o corte ingenuo que o produtor faz hoje (`actualPct >
 * targetPct`) por tres coisas que ele nao tem como ter:
 *
 *   - BANDA. Meta 30% com real 30,4% nao e rompimento. So desvio maior que
 *     a banda da politica conta.
 *   - BORDA. Notifica quando o balde SAI da banda, nao a cada avaliacao em
 *     que ele continua fora.
 *   - ESCOPO. Cada balde arma e desarma sozinho — estourar em cripto nao
 *     silencia o alerta de FIIs.
 *
 * O desvio e absoluto de proposito. O produtor atual so publica quando o
 * real passou da meta, mas a regra tambem cobre o lado de baixo (ficar 10pp
 * ABAIXO da meta de renda variavel e igualmente sair do plano) sem precisar
 * de uma segunda regra quando o produtor evoluir.
 */
export class AllocationDriftRule implements ThresholdRule<AllocationDriftInput> {
	readonly id = THRESHOLD_RULE_IDS.AllocationDrift;

	scopeOf(input: AllocationDriftInput): string {
		return input.bucket;
	}

	evaluate(
		input: AllocationDriftInput,
		previous: ThresholdStateSnapshot | null,
		policy: ResolvedThresholdPolicy,
		now: Date
	): ThresholdDecision {
		const scope = this.scopeOf(input);

		if (
			!Number.isFinite(input.targetPct) ||
			!Number.isFinite(input.actualPct)
		) {
			return {
				ruleId: this.id,
				scope,
				outcome: 'invalid',
				reason: 'leitura de alocacao sem meta ou sem valor real',
				shouldNotify: false,
				nextState: null,
				evidence: [],
				metrics: {},
			};
		}

		const deviationPp = input.actualPct - input.targetPct;
		const magnitude = Math.abs(deviationPp);
		const breachAt = policy.allocationDriftBandPp;

		const edge = decideEdge({
			magnitude,
			breachAt,
			releaseAt: breachAt * RELEASE_BAND_FACTOR,
			previous,
			cooldownHours: policy.cooldownHours,
			now,
			referenceValue: round2(magnitude),
		});

		return {
			ruleId: this.id,
			scope,
			outcome: edge.outcome,
			reason: edge.reason,
			shouldNotify: edge.shouldNotify,
			nextState: edge.nextState,
			evidence: [
				{
					label: 'Balde da meta',
					value: input.bucket,
					source: 'allocation.bucket',
				},
				{
					label: 'Meta (%)',
					value: round2(input.targetPct),
					source: 'allocation.targetPct',
				},
				{
					label: 'Exposicao real (%)',
					value: round2(input.actualPct),
					source: 'allocation.actualPct',
				},
				{
					label: 'Desvio (pontos percentuais)',
					value: round2(deviationPp),
					source: 'allocation.deviationPp',
				},
				{
					label: 'Banda de tolerancia (pontos percentuais)',
					value: round2(breachAt),
					source: 'threshold.allocationDriftBandPp',
				},
			],
			metrics: {
				targetPct: round2(input.targetPct),
				actualPct: round2(input.actualPct),
				deviationPp: round2(deviationPp),
				bandPp: round2(breachAt),
			},
		};
	}
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}
