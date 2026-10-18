import type { CorrelationMatrixResult } from 'src/portfolio/history/asset-correlation';
import type { PortfolioErrorRadarAlert } from './portfolio-error-radar.types';

/**
 * Alertas de correlação do Radar Anti-Erro (TRA-70). Dois ativos que sobem e
 * caem juntos diversificam pouco entre si: o alerta aparece quando o par anda
 * junto (correlação de Pearson dos retornos diários de 12 meses ≥ 0,80) E
 * pesa na carteira (os dois somam 20% ou mais). Par pequeno muito
 * correlacionado não muda o risco da carteira e só faria barulho.
 *
 * Só usa pares que `computeCorrelationMatrix` conseguiu calcular com dias em
 * comum suficientes: par sem base não vira alerta, nunca vira número.
 */
export const CORRELATION_ALERT_THRESHOLD = 0.8;
export const CORRELATION_HIGH_SEVERITY = 0.9;
export const CORRELATION_MIN_COMBINED_WEIGHT_PCT = 20;
const MAX_CORRELATION_ALERTS = 3;

const pt = (value: number, digits = 2) =>
	value.toLocaleString('pt-BR', {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	});

export function correlationAlerts(
	matrix: CorrelationMatrixResult,
	/** Peso de cada símbolo na carteira, em %, a valor de mercado. */
	weightPct: Record<string, number>
): PortfolioErrorRadarAlert[] {
	const combinedOf = (a: string, b: string) =>
		(weightPct[a] ?? 0) + (weightPct[b] ?? 0);
	return matrix.pairs
		.filter(
			(pair) =>
				pair.correlation !== null &&
				pair.correlation >= CORRELATION_ALERT_THRESHOLD &&
				combinedOf(pair.a, pair.b) >= CORRELATION_MIN_COMBINED_WEIGHT_PCT
		)
		.sort((x, y) => (y.correlation ?? 0) - (x.correlation ?? 0))
		.slice(0, MAX_CORRELATION_ALERTS)
		.map((pair) => {
			const correlation = pair.correlation as number;
			const combined = combinedOf(pair.a, pair.b);
			return {
				code: 'CORRELATION_HIGH_PAIR',
				type: 'correlation' as const,
				severity:
					correlation >= CORRELATION_HIGH_SEVERITY
						? ('high' as const)
						: ('medium' as const),
				symbol: pair.a,
				message: `${pair.a} e ${pair.b} andam juntos (correlação de ${pt(correlation)} em 12 meses) e somam ${pt(combined, 1)}% da carteira: quando um cai, o outro costuma cair junto.`,
				evidence: {
					metric: {
						label: `Correlação ${pair.a} × ${pair.b}`,
						value: correlation,
						unit: 'ratio' as const,
					},
					limit: {
						label: 'Limiar do modelo',
						value: CORRELATION_ALERT_THRESHOLD,
						unit: 'ratio' as const,
						source: 'model' as const,
					},
					excess: Number(
						(correlation - CORRELATION_ALERT_THRESHOLD).toFixed(4)
					),
					basis: `Retornos diários dos últimos 12 meses, ${pair.observations} dias em comum. Pesos a valor de mercado.`,
					rule: `Correlação de Pearson dos retornos diários; alerta quando chega a ${pt(CORRELATION_ALERT_THRESHOLD)} e o par soma ${CORRELATION_MIN_COMBINED_WEIGHT_PCT}% ou mais da carteira.`,
				},
			};
		});
}
