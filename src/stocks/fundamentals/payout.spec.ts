import { computePayout } from './payout';

describe('computePayout', () => {
	it('calcula o quociente de totais do mesmo exercicio', () => {
		expect(
			computePayout({
				dividendsTotal: -3817472000,
				netIncome: 6254050000,
				dividendsPeriod: '2024',
				netIncomePeriod: '2024',
			}),
		).toBeCloseTo(61.04, 1);
	});

	it('usa o valor absoluto dos dividendos, que vem negativo', () => {
		const negativo = computePayout({
			dividendsTotal: -500,
			netIncome: 1000,
			dividendsPeriod: '2024',
			netIncomePeriod: '2024',
		});
		const positivo = computePayout({
			dividendsTotal: 500,
			netIncome: 1000,
			dividendsPeriod: '2024',
			netIncomePeriod: '2024',
		});
		expect(negativo).toBe(50);
		expect(positivo).toBe(50);
	});

	it('recusa exercicios diferentes', () => {
		expect(
			computePayout({
				dividendsTotal: -500,
				netIncome: 1000,
				dividendsPeriod: '2024',
				netIncomePeriod: '2023',
			}),
		).toBeNull();
	});

	it('recusa quando algum periodo e desconhecido', () => {
		expect(
			computePayout({
				dividendsTotal: -500,
				netIncome: 1000,
				dividendsPeriod: null,
				netIncomePeriod: '2024',
			}),
		).toBeNull();
	});

	it('recusa lucro zero ou negativo', () => {
		expect(
			computePayout({
				dividendsTotal: -500,
				netIncome: 0,
				dividendsPeriod: '2024',
				netIncomePeriod: '2024',
			}),
		).toBeNull();
		expect(
			computePayout({
				dividendsTotal: -500,
				netIncome: -1000,
				dividendsPeriod: '2024',
				netIncomePeriod: '2024',
			}),
		).toBeNull();
	});

	it('recusa insumo ausente', () => {
		expect(
			computePayout({
				dividendsTotal: null,
				netIncome: 1000,
				dividendsPeriod: '2024',
				netIncomePeriod: '2024',
			}),
		).toBeNull();
	});

	it('nao reproduz o resultado de DY x P/L', () => {
		// DY 4,21% x P/L 31,97 = 134,6%. O payout publicado e 61,04%.
		// Este teste existe para travar a via proibida: se alguem trocar a
		// implementacao por DY x P/L, o resultado sai da faixa.
		const resultado = computePayout({
			dividendsTotal: -3817472000,
			netIncome: 6254050000,
			dividendsPeriod: '2024',
			netIncomePeriod: '2024',
		});
		expect(resultado).toBeLessThan(100);
	});
});
