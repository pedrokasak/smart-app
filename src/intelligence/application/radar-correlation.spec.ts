import type { CorrelationMatrixResult } from 'src/portfolio/history/asset-correlation';
import { correlationAlerts } from './radar-correlation';

const matrix = (
	pairs: Array<{ a: string; b: string; correlation: number | null }>
): CorrelationMatrixResult => ({
	symbols: [],
	matrix: [],
	pairs: pairs.map((pair) => ({ ...pair, observations: 240 })),
	averageCorrelation: null,
	highestPair: null,
	lowestPair: null,
	missingSymbols: [],
});

describe('correlationAlerts (TRA-70)', () => {
	it('alerts a correlated pair that weighs 20% or more, with evidence', () => {
		const [alert] = correlationAlerts(
			matrix([{ a: 'PETR4', b: 'PRIO3', correlation: 0.86 }]),
			{ PETR4: 15, PRIO3: 12 }
		);

		expect(alert).toMatchObject({
			code: 'CORRELATION_HIGH_PAIR',
			type: 'correlation',
			severity: 'medium',
			symbol: 'PETR4',
		});
		expect(alert.message).toBe(
			'PETR4 e PRIO3 andam juntos (correlação de 0,86 em 12 meses) e somam 27,0% da carteira: quando um cai, o outro costuma cair junto.'
		);
		expect(alert.evidence).toMatchObject({
			metric: { value: 0.86, unit: 'ratio' },
			limit: { value: 0.8, source: 'model' },
			excess: 0.06,
		});
		expect(alert.evidence?.basis).toContain('240 dias em comum');
	});

	it('0,90 or more is high severity', () => {
		const [alert] = correlationAlerts(
			matrix([{ a: 'ITUB4', b: 'BBDC4', correlation: 0.93 }]),
			{ ITUB4: 20, BBDC4: 10 }
		);
		expect(alert.severity).toBe('high');
	});

	it('ignores pairs below the threshold, small pairs and pairs without data', () => {
		expect(
			correlationAlerts(
				matrix([
					{ a: 'A', b: 'B', correlation: 0.79 },
					{ a: 'C', b: 'D', correlation: 0.95 },
					{ a: 'E', b: 'F', correlation: null },
				]),
				{ A: 30, B: 30, C: 5, D: 5, E: 30, F: 30 }
			)
		).toEqual([]);
	});

	it('keeps at most the 3 strongest pairs', () => {
		const alerts = correlationAlerts(
			matrix([
				{ a: 'A', b: 'B', correlation: 0.81 },
				{ a: 'A', b: 'C', correlation: 0.95 },
				{ a: 'B', b: 'C', correlation: 0.9 },
				{ a: 'A', b: 'D', correlation: 0.85 },
			]),
			{ A: 25, B: 25, C: 25, D: 25 }
		);
		expect(alerts.map((alert) => alert.evidence?.metric.value)).toEqual([
			0.95, 0.9, 0.85,
		]);
	});
});
