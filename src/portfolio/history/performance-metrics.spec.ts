import { MIN_OBSERVATIONS } from './benchmark-metrics';
import {
	buildPeriodTable,
	computeCalmar,
	computeConcentration,
	computeMonthStats,
	computeRecoveryDays,
	computeRelativePerformance,
	computeSortino,
	periodReturns,
	rollingTwelveMonths,
} from './performance-metrics';

/** N dias úteis a partir de uma data (segunda). */
const businessDays = (n: number, start = '2025-01-06'): string[] => {
	const out: string[] = [];
	const cursor = new Date(`${start}T00:00:00.000Z`);
	while (out.length < n) {
		const weekday = cursor.getUTCDay();
		if (weekday !== 0 && weekday !== 6) {
			out.push(cursor.toISOString().slice(0, 10));
		}
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return out;
};

const dated = (values: number[], start?: string) => {
	const days = businessDays(values.length, start);
	return values.map((value, i) => ({ date: days[i], value }));
};

const wave = (n: number, up = 0.01, down = -0.008) =>
	Array.from({ length: n }, (_, i) => (i % 2 === 0 ? up : down));

describe('computeSortino', () => {
	it('só o desvio abaixo do CDI entra no denominador', () => {
		const values = wave(60);
		const rf = 0.0004;
		const result = computeSortino(dated(values), dated(Array(60).fill(rf)));

		const excess = values.map((v) => v - rf);
		const avg = excess.reduce((s, v) => s + v, 0) / excess.length;
		const downside = Math.sqrt(
			excess.reduce((s, v) => s + Math.min(0, v) ** 2, 0) / excess.length
		);
		expect(result.sortino).toBeCloseTo((avg / downside) * Math.sqrt(252), 4);
	});

	// O ponto do Sortino: alta forte não vira "risco".
	it('é maior que o Sharpe quando a volatilidade vem de altas', () => {
		const values = Array.from({ length: 60 }, (_, i) =>
			i % 5 === 0 ? 0.05 : i % 2 ? 0.002 : -0.001
		);
		const result = computeSortino(dated(values), dated(Array(60).fill(0)));
		const avg = values.reduce((s, v) => s + v, 0) / values.length;
		const sd = Math.sqrt(
			values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1)
		);
		expect(result.sortino as number).toBeGreaterThan(
			(avg / sd) * Math.sqrt(252)
		);
	});

	it('é indefinido sem nenhum dia abaixo do CDI', () => {
		expect(
			computeSortino(dated(Array(60).fill(0.01)), dated(Array(60).fill(0)))
				.sortino
		).toBeNull();
	});

	it('não calcula com poucos dias', () => {
		const n = MIN_OBSERVATIONS - 1;
		expect(
			computeSortino(dated(wave(n)), dated(Array(n).fill(0))).sortino
		).toBeNull();
	});
});

describe('computeCalmar', () => {
	it('divide o retorno anual pela pior queda', () => {
		expect(computeCalmar(0.15, -0.1)).toBeCloseTo(1.5, 6);
	});

	it('é indefinido sem queda ou sem dado', () => {
		expect(computeCalmar(0.15, 0)).toBeNull();
		expect(computeCalmar(null, -0.1)).toBeNull();
	});
});

describe('computeRelativePerformance', () => {
	it('carteira que replica o índice captura 100% nos dois lados e IR nulo', () => {
		const values = wave(60);
		const result = computeRelativePerformance(dated(values), dated(values));

		expect(result.upCapture).toBeCloseTo(1, 6);
		expect(result.downCapture).toBeCloseTo(1, 6);
		// Retorno ativo zero todo dia: sem desvio, IR indefinido.
		expect(result.informationRatio).toBeNull();
	});

	it('carteira com metade da amplitude captura metade nos dois lados', () => {
		const index = wave(60, 0.02, -0.02);
		const portfolio = index.map((v) => v / 2);
		const result = computeRelativePerformance(dated(portfolio), dated(index));

		expect(result.upCapture as number).toBeCloseTo(0.5, 1);
		expect(result.downCapture as number).toBeCloseTo(0.5, 1);
	});

	it('information ratio positivo quando a carteira bate o índice com constância', () => {
		const index = wave(60);
		const portfolio = index.map((v, i) => v + 0.001 + (i % 3) * 0.0001);
		const result = computeRelativePerformance(dated(portfolio), dated(index));

		expect(result.informationRatio as number).toBeGreaterThan(0);
	});

	it('não calcula com poucos dias', () => {
		const n = MIN_OBSERVATIONS - 1;
		expect(
			computeRelativePerformance(dated(wave(n)), dated(wave(n))).upCapture
		).toBeNull();
	});
});

describe('periodReturns', () => {
	it('encadeia os dias de cada mês e marca o primeiro e o último como parciais', () => {
		const returns = [
			{ date: '2025-01-30', value: 0.1 },
			{ date: '2025-01-31', value: 0.1 },
			{ date: '2025-02-03', value: -0.05 },
			{ date: '2025-03-03', value: 0.02 },
		];

		const monthly = periodReturns(returns, 'month');

		expect(monthly).toEqual([
			{ period: '2025-01', value: 0.21, partial: true },
			{ period: '2025-02', value: -0.05, partial: false },
			{ period: '2025-03', value: 0.02, partial: true },
		]);
	});

	it('agrupa por ano', () => {
		const yearly = periodReturns(
			[
				{ date: '2024-12-30', value: 0.1 },
				{ date: '2025-01-02', value: 0.1 },
				{ date: '2025-06-02', value: 0.1 },
			],
			'year'
		);
		expect(yearly.map((row) => row.period)).toEqual(['2024', '2025']);
		expect(yearly[1].value).toBeCloseTo(0.21, 6);
	});
});

describe('buildPeriodTable', () => {
	// As três colunas de uma linha precisam cobrir o mesmo intervalo.
	it('encadeia CDI e índice só nos dias que a carteira tem', () => {
		const portfolio = [
			{ date: '2025-02-03', value: 0.01 },
			{ date: '2025-02-04', value: 0.01 },
		];
		const cdi = [
			{ date: '2025-01-31', value: 0.5 }, // antes da carteira: fora
			{ date: '2025-02-03', value: 0.001 },
			{ date: '2025-02-04', value: 0.001 },
		];

		const table = buildPeriodTable({
			portfolio,
			cdi,
			benchmark: [],
			granularity: 'month',
		});

		expect(table).toHaveLength(1);
		expect(table[0].cdi).toBeCloseTo(1.001 ** 2 - 1, 8);
		expect(table[0].benchmark).toBeNull();
	});
});

describe('computeMonthStats', () => {
	const row = (period: string, value: number, partial = false) => ({
		period,
		value,
		partial,
	});

	// Mês corrente pela metade não pode virar "o pior mês".
	it('ignora meses parciais', () => {
		const stats = computeMonthStats([
			row('2025-01', -0.2, true),
			row('2025-02', 0.03),
			row('2025-03', -0.01),
			row('2025-04', 0.02),
			row('2025-05', 0.5, true),
		]);

		expect(stats.best?.period).toBe('2025-02');
		expect(stats.worst?.period).toBe('2025-03');
		expect(stats.positiveShare).toBeCloseTo(2 / 3, 6);
		expect(stats.months).toBe(3);
	});

	it('vazio sem mês completo', () => {
		expect(computeMonthStats([row('2025-01', 0.1, true)])).toEqual({
			best: null,
			worst: null,
			positiveShare: null,
			months: 0,
		});
	});
});

describe('rollingTwelveMonths', () => {
	it('acumula as 12 janelas mensais anteriores', () => {
		const monthly = Array.from({ length: 14 }, (_, i) => ({
			period: `2025-${String(i + 1).padStart(2, '0')}`,
			value: 0.01,
			partial: false,
		}));

		const rolling = rollingTwelveMonths(monthly);

		expect(rolling).toHaveLength(3);
		expect(rolling[0].value).toBeCloseTo(1.01 ** 12 - 1, 6);
	});

	it('vazio com menos de 12 meses completos', () => {
		expect(
			rollingTwelveMonths([{ period: '2025-01', value: 0.1, partial: false }])
		).toEqual([]);
	});
});

describe('computeRecoveryDays', () => {
	it('conta os pregões entre o fundo e a recuperação', () => {
		const returns = dated(Array(10).fill(0.01));
		expect(computeRecoveryDays(returns, returns[2].date, returns[6].date)).toBe(
			4
		);
	});

	it('nulo quando ainda não recuperou', () => {
		expect(computeRecoveryDays([], '2025-01-06', null)).toBeNull();
	});
});

describe('computeConcentration', () => {
	it('dez posições iguais equivalem a dez ativos', () => {
		const result = computeConcentration(Array(10).fill(100));
		expect(result.effectiveAssets).toBeCloseTo(10, 6);
		expect(result.hhi).toBeCloseTo(0.1, 6);
		expect(result.topWeightPct).toBeCloseTo(10, 6);
	});

	// O ponto da métrica: contar posições engana.
	it('uma posição dominante derruba o número efetivo', () => {
		const result = computeConcentration([800, ...Array(9).fill(200 / 9)]);
		expect(result.positions).toBe(10);
		expect(result.effectiveAssets as number).toBeLessThan(1.6);
	});

	it('vazio sem valor', () => {
		expect(computeConcentration([]).effectiveAssets).toBeNull();
	});
});
