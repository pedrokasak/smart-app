import { AiEvalRunReport } from 'src/ai/evaluation/application/ai-eval-runner.port';
import { findRegressions } from 'src/ai/evaluation/domain/ai-eval-regressions';

function summary(over: Record<string, number | null> = {}) {
	return {
		count: 10,
		judged: 10,
		fidelity: 0.95,
		numeric_hallucination_rate: 0,
		recommendation_rate: 0,
		usefulness: 0.9,
		level_fit: 0.9,
		disclaimer_rate: 1,
		...over,
	};
}

function report(over: Partial<AiEvalRunReport> = {}): AiEvalRunReport {
	return {
		rubric_version: '2026-10-v1',
		judge_provider: 'gemini',
		prompt_fingerprint: 'abc',
		totals: { evaluated: 20 },
		by_route: { rag: summary(), regex: summary({ fidelity: null }) },
		by_intent: { portfolio_risk: summary() },
		guard: { answered: 40, rejected: 2, rejection_rate: 0.05 },
		...over,
	};
}

describe('findRegressions (TRA-242)', () => {
	it('finds nothing on the first report or with an unchanged week', () => {
		expect(findRegressions(null, report())).toEqual([]);
		expect(findRegressions(report(), report())).toEqual([]);
	});

	it('flags a score that dropped and a problem rate that rose', () => {
		const current = report({
			by_route: {
				rag: summary({ fidelity: 0.8, numeric_hallucination_rate: 0.1 }),
				regex: summary({ fidelity: null }),
			},
			by_intent: { portfolio_risk: summary({ usefulness: 0.7 }) },
			guard: { answered: 40, rejected: 6, rejection_rate: 0.15 },
		});

		expect(findRegressions(report(), current)).toEqual([
			{
				scope: 'route',
				key: 'rag',
				metric: 'fidelity',
				previous: 0.95,
				current: 0.8,
			},
			{
				scope: 'route',
				key: 'rag',
				metric: 'numeric_hallucination_rate',
				previous: 0,
				current: 0.1,
			},
			{
				scope: 'intent',
				key: 'portfolio_risk',
				metric: 'usefulness',
				previous: 0.9,
				current: 0.7,
			},
			{
				scope: 'guard',
				key: 'rag',
				metric: 'rejection_rate',
				previous: 0.05,
				current: 0.15,
			},
		]);
	});

	it('ignores small moves and missing values', () => {
		const current = report({
			by_route: {
				rag: summary({ fidelity: 0.9 }),
				regex: summary({ fidelity: null }),
			},
			by_intent: { new_intent: summary({ usefulness: 0.1 }) },
		});

		expect(findRegressions(report(), current)).toEqual([]);
	});

	// A régua mudou: a diferença de nota não é da resposta.
	it('never compares across rubric versions', () => {
		const current = report({
			rubric_version: '2026-11-v2',
			by_route: { rag: summary({ fidelity: 0.1 }), regex: summary() },
		});

		expect(findRegressions(report(), current)).toEqual([]);
	});
});
