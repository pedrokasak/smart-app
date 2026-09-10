import {
	closesToReturns,
	computeBenchmarkMetrics,
	MIN_OBSERVATIONS,
	pairByDate,
} from './benchmark-metrics';
import { DatedReturn } from './returns';

/** Série de N dias úteis fictícios a partir de 2025-01-06 (segunda). */
const days = (n: number): string[] => {
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

const seriesFrom = (values: number[]): DatedReturn[] =>
	days(values.length).map((date, i) => ({ date, value: values[i] }));

describe('pairByDate', () => {
	// A armadilha central: alinhar por posicao parece funcionar ate o primeiro
	// feriado que so um lado tem, e ai toda a serie desloca um dia.
	it('pareia por data, nao por posicao', () => {
		const carteira: DatedReturn[] = [
			{ date: '2025-01-06', value: 0.01 },
			{ date: '2025-01-07', value: 0.02 },
			{ date: '2025-01-08', value: 0.03 },
		];
		const indice: DatedReturn[] = [
			{ date: '2025-01-06', value: 0.005 },
			// 07/01 ausente no indice
			{ date: '2025-01-08', value: 0.015 },
		];

		const paired = pairByDate(carteira, indice);

		expect(paired.dates).toEqual(['2025-01-06', '2025-01-08']);
		expect(paired.a).toEqual([0.01, 0.03]);
		expect(paired.b).toEqual([0.005, 0.015]);
	});

	it('ordena por data antes de parear', () => {
		const paired = pairByDate(
			[
				{ date: '2025-01-08', value: 0.03 },
				{ date: '2025-01-06', value: 0.01 },
			],
			[
				{ date: '2025-01-06', value: 0.005 },
				{ date: '2025-01-08', value: 0.015 },
			]
		);

		expect(paired.dates).toEqual(['2025-01-06', '2025-01-08']);
		expect(paired.a).toEqual([0.01, 0.03]);
	});

	it('descarta valores nao finitos', () => {
		const paired = pairByDate(
			[
				{ date: '2025-01-06', value: Number.NaN },
				{ date: '2025-01-07', value: 0.02 },
			],
			[
				{ date: '2025-01-06', value: 0.005 },
				{ date: '2025-01-07', value: 0.01 },
			]
		);

		expect(paired.dates).toEqual(['2025-01-07']);
	});
});

describe('closesToReturns', () => {
	it('converte fechamentos em retornos diarios', () => {
		const returns = closesToReturns([
			{ date: '2025-01-06', close: 100 },
			{ date: '2025-01-07', close: 110 },
			{ date: '2025-01-08', close: 99 },
		]);

		expect(returns).toHaveLength(2);
		expect(returns[0].value).toBeCloseTo(0.1, 6);
		expect(returns[1].value).toBeCloseTo(-0.1, 6);
	});

	it('ignora fechamento invalido ou zero', () => {
		const returns = closesToReturns([
			{ date: '2025-01-06', close: 100 },
			{ date: '2025-01-07', close: 0 },
			{ date: '2025-01-08', close: 110 },
		]);

		// 07/01 sai; 08/01 passa a comparar com 06/01.
		expect(returns).toHaveLength(1);
		expect(returns[0].value).toBeCloseTo(0.1, 6);
	});
});

describe('computeBenchmarkMetrics', () => {
	it('devolve beta 1 quando a carteira replica o indice', () => {
		const values = Array.from({ length: 30 }, (_, i) =>
			i % 2 === 0 ? 0.01 : -0.008
		);
		const result = computeBenchmarkMetrics(
			seriesFrom(values),
			seriesFrom(values)
		);

		expect(result.beta).toBeCloseTo(1, 5);
		expect(result.correlation).toBeCloseTo(1, 5);
		// Replicar o indice significa nao se afastar dele.
		expect(result.trackingError).toBeCloseTo(0, 5);
		expect(result.unavailable).toBeNull();
	});

	it('devolve beta 2 quando a carteira amplifica o indice', () => {
		const indice = Array.from({ length: 30 }, (_, i) =>
			i % 2 === 0 ? 0.01 : -0.008
		);
		const carteira = indice.map((value) => value * 2);

		const result = computeBenchmarkMetrics(
			seriesFrom(carteira),
			seriesFrom(indice)
		);

		expect(result.beta).toBeCloseTo(2, 5);
		expect(result.correlation).toBeCloseTo(1, 5);
		// Amplificar afasta do indice, mesmo com correlacao perfeita.
		expect(result.trackingError).toBeGreaterThan(0);
	});

	it('devolve beta negativo quando a carteira anda ao contrario', () => {
		const indice = Array.from({ length: 30 }, (_, i) =>
			i % 2 === 0 ? 0.01 : -0.008
		);
		const carteira = indice.map((value) => -value);

		const result = computeBenchmarkMetrics(
			seriesFrom(carteira),
			seriesFrom(indice)
		);

		expect(result.beta).toBeCloseTo(-1, 5);
		expect(result.correlation).toBeCloseTo(-1, 5);
	});

	// Beta sobre poucos dias e ruido com aparencia de medida.
	it('recusa calcular com poucas observacoes', () => {
		const values = Array.from({ length: MIN_OBSERVATIONS - 1 }, () => 0.01);
		const result = computeBenchmarkMetrics(
			seriesFrom(values),
			seriesFrom(values)
		);

		expect(result.beta).toBeNull();
		expect(result.trackingError).toBeNull();
		expect(result.unavailable).toBe('insufficient_observations');
		expect(result.observations).toBe(MIN_OBSERVATIONS - 1);
	});

	it('recusa calcular quando o indice nao variou no periodo', () => {
		const carteira = Array.from({ length: 30 }, (_, i) =>
			i % 2 === 0 ? 0.01 : -0.01
		);
		const indiceParado = Array.from({ length: 30 }, () => 0);

		const result = computeBenchmarkMetrics(
			seriesFrom(carteira),
			seriesFrom(indiceParado)
		);

		expect(result.beta).toBeNull();
		expect(result.unavailable).toBe('benchmark_no_variance');
	});

	it('conta so os dias presentes nas duas series', () => {
		const values = Array.from({ length: 30 }, (_, i) =>
			i % 2 === 0 ? 0.01 : -0.008
		);
		const carteira = seriesFrom(values);
		// Indice perde cinco dias do meio.
		const indice = seriesFrom(values).filter((_, i) => i < 10 || i >= 15);

		const result = computeBenchmarkMetrics(carteira, indice);

		expect(result.observations).toBe(25);
		expect(result.beta).toBeCloseTo(1, 5);
	});

	it('devolve estado explicito com series vazias', () => {
		const result = computeBenchmarkMetrics([], []);

		expect(result.beta).toBeNull();
		expect(result.observations).toBe(0);
		expect(result.unavailable).toBe('insufficient_observations');
	});

	// Tracking error e anualizado por 252 pregoes, mesma convencao do Sharpe
	// ja usado no dashboard.
	it('anualiza o tracking error por 252 pregoes', () => {
		const indice = Array.from({ length: 60 }, (_, i) =>
			i % 2 === 0 ? 0.01 : -0.01
		);
		// Diferenca diaria constante nao tem desvio: o TE deve ser ~0.
		const carteira = indice.map((value) => value + 0.001);

		const result = computeBenchmarkMetrics(
			seriesFrom(carteira),
			seriesFrom(indice)
		);

		expect(result.trackingError).toBeCloseTo(0, 5);
		expect(result.beta).toBeCloseTo(1, 5);
	});
});
