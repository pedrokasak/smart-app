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

	it('mantem o resultado abaixo de 100 para os numeros reais de WEGE3', () => {
		// Sanidade sobre o caso real: 3,82 bi distribuidos sobre 6,25 bi de
		// lucro dao 61%, nao os 134% que a via proibida (DY x P/L) produziria
		// com os indicadores publicados.
		//
		// Isto NAO impede alguem de adotar a via proibida: PayoutInput nao
		// recebe DY nem P/L, entao ela e impossivel de escrever aqui dentro. A
		// fronteira real e a assinatura, e o risco fica no chamador — quem
		// monta os insumos precisa passar totais, nao racios. Isso se prende na
		// tarefa que liga o payout a cascata, nao neste arquivo.
		const resultado = computePayout({
			dividendsTotal: -3817472000,
			netIncome: 6254050000,
			dividendsPeriod: '2024',
			netIncomePeriod: '2024',
		});
		expect(resultado).toBeLessThan(100);
	});

	it('devolve null quando o lucro e positivo mas insignificante demais para dar resultado finito', () => {
		expect(
			computePayout({
				dividendsTotal: -500,
				netIncome: Number.MIN_VALUE,
				dividendsPeriod: '2024',
				netIncomePeriod: '2024',
			}),
		).toBeNull();
	});

	it('nao suprime payout legitimo acima de 100%', () => {
		expect(
			computePayout({
				dividendsTotal: -1200,
				netIncome: 1000,
				dividendsPeriod: '2024',
				netIncomePeriod: '2024',
			}),
		).toBe(120);
	});
});
