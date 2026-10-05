import {
	AiEvalRunReport,
	AiEvalSummary,
} from 'src/ai/evaluation/application/ai-eval-runner.port';

/** Uma métrica que piorou de uma semana para a outra (TRA-242). */
export interface AiEvalRegression {
	scope: 'route' | 'intent' | 'guard';
	key: string;
	metric: string;
	previous: number;
	current: number;
}

/** Notas: caiu tanto ou mais, é regressão. */
const SCORE_DROP = 0.1;
/** Taxas de problema: subiu tanto ou mais, é regressão. */
const RATE_RISE = 0.05;

const SCORES: (keyof AiEvalSummary)[] = ['fidelity', 'usefulness', 'level_fit'];
const RATES: (keyof AiEvalSummary)[] = [
	'numeric_hallucination_rate',
	'recommendation_rate',
];

function compare(
	scope: 'route' | 'intent',
	previous: Record<string, AiEvalSummary>,
	current: Record<string, AiEvalSummary>
): AiEvalRegression[] {
	const regressions: AiEvalRegression[] = [];
	for (const [key, now] of Object.entries(current ?? {})) {
		const before = previous?.[key];
		if (!before) continue;
		for (const metric of SCORES) {
			const [a, b] = [before[metric], now[metric]];
			if (
				typeof a === 'number' &&
				typeof b === 'number' &&
				a - b >= SCORE_DROP
			) {
				regressions.push({ scope, key, metric, previous: a, current: b });
			}
		}
		for (const metric of RATES) {
			const [a, b] = [before[metric], now[metric]];
			if (
				typeof a === 'number' &&
				typeof b === 'number' &&
				b - a >= RATE_RISE
			) {
				regressions.push({ scope, key, metric, previous: a, current: b });
			}
		}
	}
	return regressions;
}

/**
 * Dois relatórios só se comparam na mesma rubrica: com régua diferente, a
 * mudança de nota viria da régua, não da resposta.
 */
export function isComparable(
	previous: AiEvalRunReport | null | undefined,
	current: AiEvalRunReport
): previous is AiEvalRunReport {
	return !!previous && previous.rubric_version === current.rubric_version;
}

/** O que piorou desde o relatório anterior. */
export function findRegressions(
	previous: AiEvalRunReport | null,
	current: AiEvalRunReport
): AiEvalRegression[] {
	if (!isComparable(previous, current)) return [];
	const regressions = [
		...compare('route', previous.by_route, current.by_route),
		...compare('intent', previous.by_intent, current.by_intent),
	];
	const [a, b] = [
		previous.guard?.rejection_rate,
		current.guard?.rejection_rate,
	];
	if (typeof a === 'number' && typeof b === 'number' && b - a >= RATE_RISE) {
		regressions.push({
			scope: 'guard',
			key: 'rag',
			metric: 'rejection_rate',
			previous: a,
			current: b,
		});
	}
	return regressions;
}
