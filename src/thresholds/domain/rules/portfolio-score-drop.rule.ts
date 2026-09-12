import { RELEASE_BAND_FACTOR, decideEdge } from '../edge-trigger';
import {
	ResolvedThresholdPolicy,
	THRESHOLD_RULE_IDS,
	ThresholdDecision,
	ThresholdRule,
	ThresholdStateSnapshot,
} from '../threshold.types';

export interface PortfolioScoreInput {
	score: number;
	maxScore: number;
}

/** Escopo fixo: a regra e da carteira inteira, nao de um balde. */
export const PORTFOLIO_SCORE_SCOPE = 'portfolio';

/**
 * Regra da queda de score de diversificacao (TRA-136, fase 4).
 *
 * Diferente da alocacao, aqui nao existe "meta": o que importa e a VARIACAO
 * contra a leitura anterior. Duas armadilhas moram nisso, e as duas estao
 * resolvidas pela escolha do valor de referencia.
 *
 * 1. QUEDA LENTA. Comparar sempre com a leitura imediatamente anterior faz
 *    uma queda de 3 pontos por dia durante uma semana nunca disparar, ainda
 *    que a carteira tenha perdido 21 pontos. Por isso a referencia guardada
 *    e o PICO de score desde o ultimo desarme, nao a ultima leitura: a
 *    queda medida e sempre contra o melhor estado conhecido.
 *
 * 2. ANCORA PRESA. Se a referencia nunca subisse, uma carteira que melhorou
 *    de verdade ficaria comparada com um pico antigo para sempre. Por isso
 *    score maior que a referencia SOBE a referencia (e desarma, se estava
 *    armado): o novo pico vira a nova base de comparacao.
 *
 * Primeira leitura de um usuario nao notifica — nao ha queda contra nada.
 * Ela so grava a base. Isso e explicito porque o contrario (tratar ausencia
 * de estado como score anterior 100) dispararia para toda carteira nova.
 */
export class PortfolioScoreDropRule implements ThresholdRule<PortfolioScoreInput> {
	readonly id = THRESHOLD_RULE_IDS.PortfolioScoreDrop;

	scopeOf(): string {
		return PORTFOLIO_SCORE_SCOPE;
	}

	evaluate(
		input: PortfolioScoreInput,
		previous: ThresholdStateSnapshot | null,
		policy: ResolvedThresholdPolicy,
		now: Date
	): ThresholdDecision {
		const scope = this.scopeOf();
		const nowIso = now.toISOString();

		if (!Number.isFinite(input.score) || !Number.isFinite(input.maxScore)) {
			return this.invalid(scope, 'leitura de score sem numero utilizavel');
		}

		if (!previous) {
			return {
				ruleId: this.id,
				scope,
				outcome: 'suppressed_inside_band',
				reason: 'primeira leitura de score — apenas registra a base',
				shouldNotify: false,
				nextState: {
					breaching: false,
					referenceValue: input.score,
					lastNotifiedAt: null,
					lastEvaluatedAt: nowIso,
				},
				evidence: [],
				metrics: {},
			};
		}

		const peak = Math.max(previous.referenceValue, input.score);
		const dropPoints = peak - input.score;
		const breachAt = policy.scoreDropPoints;

		const edge = decideEdge({
			magnitude: dropPoints,
			breachAt,
			releaseAt: breachAt * RELEASE_BAND_FACTOR,
			previous,
			cooldownHours: policy.cooldownHours,
			now,
			// Referencia do proximo ciclo: o pico. Quando a queda desarma, a
			// borda de descida ja aconteceu com o pico antigo — mante-lo aqui
			// e o que impede a ancora de escorregar junto com o score.
			referenceValue: peak,
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
					label: 'Score de diversificacao atual',
					value: round2(input.score),
					source: 'portfolio.score.current',
				},
				{
					label: 'Melhor score anterior',
					value: round2(peak),
					source: 'portfolio.score.previous',
				},
				{
					label: 'Queda (pontos)',
					value: round2(dropPoints),
					source: 'portfolio.score.dropPoints',
				},
				{
					label: 'Score maximo da escala',
					value: round2(input.maxScore),
					source: 'portfolio.score.maxScore',
				},
				{
					label: 'Queda minima notificavel (pontos)',
					value: round2(breachAt),
					source: 'threshold.scoreDropPoints',
				},
			],
			metrics: {
				score: round2(input.score),
				previousScore: round2(peak),
				dropPoints: round2(dropPoints),
				maxScore: round2(input.maxScore),
			},
		};
	}

	private invalid(scope: string, reason: string): ThresholdDecision {
		return {
			ruleId: this.id,
			scope,
			outcome: 'invalid',
			reason,
			shouldNotify: false,
			nextState: null,
			evidence: [],
			metrics: {},
		};
	}
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}
