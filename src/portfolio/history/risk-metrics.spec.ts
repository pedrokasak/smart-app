import { MIN_OBSERVATIONS } from './benchmark-metrics';
import {
	computeDrawdown,
	computeHistoricalVar,
	computeSharpe,
	quantile,
} from './risk-metrics';

/** N dias úteis a partir de 2025-01-06 (segunda). */
const businessDays = (n: number): string[] => {
	const out: string[] = [];
	const cursor = new Date(Date.UTC(2025, 0, 6));
	while (out.length < n) {
		const weekday = cursor.getUTCDay();
		if (weekday !== 0 && weekday !== 6) {
			out.push(cursor.toISOString().slice(0, 10));
		}
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return out;
};

const dated = (values: number[]) => {
	const days = businessDays(values.length);
	return values.map((value, i) => ({ date: days[i], value }));
};

const wave = (n: number, up = 0.01, down = -0.008) =>
	Array.from({ length: n }, (_, i) => (i % 2 === 0 ? up : down));

describe('quantile', () => {
	it('interpola entre vizinhos', () => {
		expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
		expect(quantile([0, 10], 0.25)).toBeCloseTo(2.5, 6);
	});
});

describe('computeSharpe', () => {
	it('desconta o CDI diário e anualiza por √252', () => {
		const portfolio = dated(wave(60));
		const rf = dated(Array(60).fill(0.0004));

		const result = computeSharpe(portfolio, rf);

		const excess = wave(60).map((v) => v - 0.0004);
		const avg = excess.reduce((s, v) => s + v, 0) / excess.length;
		const sd = Math.sqrt(
			excess.reduce((s, v) => s + (v - avg) ** 2, 0) / (excess.length - 1)
		);
		expect(result.sharpe).toBeCloseTo((avg / sd) * Math.sqrt(252), 4);
		expect(result.observations).toBe(60);
	});

	it('devolve a taxa livre de risco anual efetiva do período', () => {
		const result = computeSharpe(
			dated(wave(60)),
			dated(Array(60).fill(0.0004))
		);

		expect(result.riskFreeAnnual).toBeCloseTo(1.0004 ** 252 - 1, 5);
	});

	// Pareamento por data: o CDI não tem os mesmos dias da carteira.
	it('só usa dias presentes nas duas séries', () => {
		const portfolio = dated(wave(60));
		const rf = dated(Array(60).fill(0.0004)).filter((_, i) => i % 3 !== 0);

		expect(computeSharpe(portfolio, rf).observations).toBe(40);
	});

	it('não calcula com poucos dias', () => {
		const result = computeSharpe(
			dated(wave(MIN_OBSERVATIONS - 1)),
			dated(Array(MIN_OBSERVATIONS - 1).fill(0.0004))
		);

		expect(result.sharpe).toBeNull();
		expect(result.riskFreeAnnual).toBeNull();
	});
});

describe('computeHistoricalVar', () => {
	it('usa o percentil 5% das janelas de 21 pregões sobre o patrimônio', () => {
		// 80 dias de queda de 0,1% ao dia: toda janela perde o mesmo.
		const result = computeHistoricalVar(dated(Array(80).fill(-0.001)), {
			portfolioValue: 100000,
		});

		const expected = 1 - 0.999 ** 21;
		expect(result.windows).toBe(60);
		expect(result.varPct).toBeCloseTo(expected, 6);
		expect(result.amount).toBeCloseTo(expected * 100000, 1);
		expect(result.cvarPct).toBeCloseTo(expected, 6);
	});

	it('CVaR é pelo menos o VaR', () => {
		const returns = dated(
			Array.from({ length: 120 }, (_, i) =>
				i % 17 === 0 ? -0.04 : i % 2 ? 0.006 : -0.004
			)
		);
		const result = computeHistoricalVar(returns, { portfolioValue: 50000 });

		expect(result.varPct).not.toBeNull();
		expect(result.cvarPct as number).toBeGreaterThanOrEqual(
			result.varPct as number
		);
	});

	// Carteira que nunca perdeu em 21 dias não tem VaR negativo.
	it('trava em zero quando nenhuma janela perde', () => {
		const result = computeHistoricalVar(dated(Array(80).fill(0.001)), {
			portfolioValue: 1000,
		});

		expect(result.varPct).toBe(0);
		expect(result.amount).toBe(0);
	});

	it('não calcula com menos janelas que o mínimo', () => {
		const result = computeHistoricalVar(dated(Array(30).fill(-0.001)), {
			portfolioValue: 1000,
		});

		expect(result.windows).toBe(10);
		expect(result.varPct).toBeNull();
		expect(result.amount).toBeNull();
	});
});

describe('computeDrawdown', () => {
	it('mede a maior queda topo-fundo com datas e duração', () => {
		// Sobe 2 dias, cai 3, recupera em 4.
		const returns = dated([0.1, 0.1, -0.1, -0.1, -0.1, 0.1, 0.1, 0.1, 0.1]);
		const days = businessDays(9);

		const result = computeDrawdown(returns);

		expect(result.maxDrawdown).toBeCloseTo(0.9 ** 3 - 1, 6);
		expect(result.peakDate).toBe(days[1]);
		expect(result.troughDate).toBe(days[4]);
		expect(result.durationDays).toBe(3);
		expect(result.recoveryDate).toBe(days[8]);
	});

	it('não recuperado devolve recoveryDate null', () => {
		const result = computeDrawdown(dated([0.05, -0.1, 0.01]));

		expect(result.maxDrawdown).toBeCloseTo(-0.1, 6);
		expect(result.recoveryDate).toBeNull();
	});

	// Queda logo no primeiro dia: o topo é o começo da série.
	it('trata queda desde o início', () => {
		const days = businessDays(3);
		const result = computeDrawdown(dated([-0.05, -0.05, 0.01]));

		expect(result.peakDate).toBe(days[0]);
		expect(result.troughDate).toBe(days[1]);
		expect(result.durationDays).toBe(2);
	});

	it('série só de alta tem drawdown zero, sem datas', () => {
		const result = computeDrawdown(dated([0.01, 0.02, 0.01]));

		expect(result.maxDrawdown).toBe(0);
		expect(result.troughDate).toBeNull();
	});

	it('não calcula com menos de dois retornos', () => {
		expect(computeDrawdown(dated([0.01])).maxDrawdown).toBeNull();
	});
});
