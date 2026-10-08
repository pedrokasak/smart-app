import { Close, computeAssetBeta } from './asset-beta';

/** Dias úteis consecutivos a partir de 2025-01-01, sem fim de semana. */
function weekdays(count: number, from = '2025-01-01'): string[] {
	const dates: string[] = [];
	const cursor = new Date(`${from}T00:00:00.000Z`);
	while (dates.length < count) {
		const day = cursor.getUTCDay();
		if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return dates;
}

/** Série de preços a partir de retornos diários. */
function series(dates: string[], returns: number[], start = 100): Close[] {
	let price = start;
	return dates.map((date, index) => {
		if (index > 0) price *= 1 + returns[index - 1];
		return { date, close: price };
	});
}

/** Retornos de mercado determinísticos, com variância. */
function marketReturns(count: number): number[] {
	return Array.from({ length: count }, (_, i) => Math.sin(i * 1.7) * 0.012);
}

describe('computeAssetBeta (TRA-251)', () => {
	const dates = weekdays(300);
	const market = marketReturns(dates.length - 1);
	const marketSeries = series(dates, market);

	it('ativo que se move 2x o mercado tem beta 2', () => {
		const asset = series(
			dates,
			market.map((r) => r * 2)
		);

		const result = computeAssetBeta(asset, marketSeries);

		expect(result.beta).toBeCloseTo(2, 2);
		expect(result.unavailable).toBeNull();
	});

	it('ativo que espelha o mercado tem beta 1', () => {
		expect(computeAssetBeta(marketSeries, marketSeries).beta).toBeCloseTo(1, 4);
	});

	it('ativo que anda ao contrário tem beta negativo', () => {
		const asset = series(
			dates,
			market.map((r) => -r)
		);

		expect(computeAssetBeta(asset, marketSeries).beta).toBeCloseTo(-1, 2);
	});

	it('usa só a janela mais recente (252 pregões)', () => {
		const result = computeAssetBeta(marketSeries, marketSeries);

		expect(result.observations).toBe(252);
		expect(result.asOf).toBe(dates[dates.length - 1]);
	});

	it('com poucos pares devolve null, sem inventar número', () => {
		const short = weekdays(60);
		const result = computeAssetBeta(
			series(short, marketReturns(59)),
			series(short, marketReturns(59))
		);

		expect(result.beta).toBeNull();
		expect(result.unavailable).toBe('insufficient_observations');
	});

	it('mercado sem variação não tem beta', () => {
		const flat = series(
			dates,
			market.map(() => 0)
		);

		const result = computeAssetBeta(marketSeries, flat);

		expect(result.beta).toBeNull();
		expect(result.unavailable).toBe('benchmark_no_variance');
	});

	it('casa por data: feriado que só o mercado tem não desloca a série', () => {
		const withHole = marketSeries.filter((_, index) => index !== 100);
		const asset = series(
			dates,
			market.map((r) => r * 2)
		);

		const result = computeAssetBeta(asset, withHole);

		// O dia 100 some dos dois lados; o retorno que cruza o buraco entra
		// como retorno de 2 dias nos dois, sem descasar.
		expect(result.beta).toBeGreaterThan(1.5);
		expect(result.beta).toBeLessThan(2.5);
	});

	it('desdobramento (salto de -90% num dia) não domina o resultado', () => {
		const returns = market.map((r) => r * 2);
		const asset = series(dates, returns);
		const splitAt = 200;
		const adjusted = asset.map((point, index) =>
			index >= splitAt ? { ...point, close: point.close / 10 } : point
		);

		const result = computeAssetBeta(adjusted, marketSeries);

		expect(result.beta).toBeCloseTo(2, 1);
		// Sem o filtro o salto domina a covariância e o número sai errado.
		const unfiltered = computeAssetBeta(adjusted, marketSeries, {
			maxAbsReturn: 5,
		});
		expect(Math.abs((unfiltered.beta ?? 0) - 2)).toBeGreaterThan(0.3);
	});

	it('ignora dias em que o ativo não negociou', () => {
		const asset = series(
			dates,
			market.map((r) => r * 2)
		).filter((_, index) => index % 9 !== 0);

		const result = computeAssetBeta(asset, marketSeries);

		expect(result.beta).not.toBeNull();
	});

	it('séries vazias não quebram', () => {
		expect(computeAssetBeta([], []).beta).toBeNull();
		expect(computeAssetBeta(marketSeries, []).beta).toBeNull();
	});
});
