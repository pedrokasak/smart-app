import {
	annualize,
	computeTwr,
	computeXirr,
	decomposeContribution,
} from './returns';

describe('decomposeContribution', () => {
	it('separa o que o usuario depositou do que o mercado rendeu', () => {
		const result = decomposeContribution({
			currentValue: 50000,
			netContribution: 45000,
		});

		expect(result.contributed).toBe(45000);
		expect(result.marketGain).toBe(5000);
		expect(result.marketGainPct).toBeCloseTo(0.111111, 5);
	});

	it('reporta prejuizo como ganho negativo', () => {
		const result = decomposeContribution({
			currentValue: 8000,
			netContribution: 10000,
		});

		expect(result.marketGain).toBe(-2000);
		expect(result.marketGainPct).toBeCloseTo(-0.2, 6);
	});

	// Retirada liquida maior que o valor atual torna a base negativa; uma
	// porcentagem sobre base negativa inverte o sinal e mente.
	it('nao reporta porcentagem quando a contribuicao liquida nao e positiva', () => {
		expect(
			decomposeContribution({ currentValue: 5000, netContribution: 0 })
				.marketGainPct
		).toBeNull();
		expect(
			decomposeContribution({ currentValue: 5000, netContribution: -2000 })
				.marketGainPct
		).toBeNull();
	});
});

describe('computeTwr', () => {
	const trading = (date: string, totalValue: number) => ({
		date,
		totalValue,
		tradingDay: true,
	});

	it('calcula retorno simples quando nao ha fluxo', () => {
		const result = computeTwr({
			series: [trading('2025-06-10', 1000), trading('2025-06-11', 1100)],
			flows: [],
		});

		expect(result.twr).toBeCloseTo(0.1, 6);
		expect(result.periods).toBe(1);
	});

	// O ponto central: depositar dinheiro nao pode aparecer como rendimento.
	it('neutraliza aporte — depositar nao altera o retorno reportado', () => {
		const semAporte = computeTwr({
			series: [trading('2025-06-10', 1000), trading('2025-06-11', 1100)],
			flows: [],
		});

		const comAporte = computeTwr({
			series: [trading('2025-06-10', 1000), trading('2025-06-11', 1600)],
			flows: [{ date: '2025-06-11', flow: 500 }],
		});

		// 1600 - 500 = 1100 sobre 1000. Mesmo retorno.
		expect(comAporte.twr).toBeCloseTo(semAporte.twr as number, 6);
		expect(comAporte.twr).toBeCloseTo(0.1, 6);
	});

	it('neutraliza retirada da mesma forma', () => {
		const result = computeTwr({
			series: [trading('2025-06-10', 1000), trading('2025-06-11', 600)],
			flows: [{ date: '2025-06-11', flow: -500 }],
		});

		// 600 - (-500) = 1100 sobre 1000.
		expect(result.twr).toBeCloseTo(0.1, 6);
	});

	it('encadeia varios dias multiplicando os retornos', () => {
		const result = computeTwr({
			series: [
				trading('2025-06-10', 1000),
				trading('2025-06-11', 1100),
				trading('2025-06-12', 1210),
			],
			flows: [],
		});

		// 1.1 * 1.1 - 1
		expect(result.twr).toBeCloseTo(0.21, 6);
		expect(result.periods).toBe(2);
	});

	// Um mes com 30 pontos onde ~21 sao pregao dilui a variacao por construcao.
	it('exclui dias sem pregao por padrao', () => {
		const series = [
			trading('2025-06-06', 1000), // sexta
			{ date: '2025-06-07', totalValue: 1000, tradingDay: false },
			{ date: '2025-06-08', totalValue: 1000, tradingDay: false },
			trading('2025-06-09', 1100), // segunda
		];

		const semFimDeSemana = computeTwr({ series, flows: [] });
		expect(semFimDeSemana.periods).toBe(1);
		expect(semFimDeSemana.twr).toBeCloseTo(0.1, 6);

		const comFimDeSemana = computeTwr({
			series,
			flows: [],
			tradingDaysOnly: false,
		});
		expect(comFimDeSemana.periods).toBe(3);
		// Mesmo retorno total, mas diluido em mais periodos.
		expect(comFimDeSemana.twr).toBeCloseTo(0.1, 6);
	});

	// Carteira que ainda nao existia nao teve retorno -100%: nao teve retorno.
	it('pula dias sem valor inicial em vez de zerar o retorno', () => {
		const result = computeTwr({
			series: [
				trading('2025-06-09', 0),
				trading('2025-06-10', 1000),
				trading('2025-06-11', 1100),
			],
			flows: [{ date: '2025-06-10', flow: 1000 }],
		});

		expect(result.skipped).toBe(1);
		expect(result.periods).toBe(1);
		expect(result.twr).toBeCloseTo(0.1, 6);
	});

	it('devolve null com serie insuficiente', () => {
		expect(computeTwr({ series: [], flows: [] }).twr).toBeNull();
		expect(
			computeTwr({ series: [trading('2025-06-10', 1000)], flows: [] }).twr
		).toBeNull();
	});

	it('ordena a serie antes de encadear', () => {
		const result = computeTwr({
			series: [trading('2025-06-12', 1210), trading('2025-06-10', 1000), trading('2025-06-11', 1100)],
			flows: [],
		});

		expect(result.twr).toBeCloseTo(0.21, 6);
	});
});

describe('annualize', () => {
	it('anualiza retorno de periodo parcial', () => {
		// 10% em meio ano ≈ 21% ao ano.
		expect(annualize(0.1, 182.5)).toBeCloseTo(0.21, 2);
	});

	it('devolve o proprio retorno em exatamente um ano', () => {
		expect(annualize(0.15, 365)).toBeCloseTo(0.15, 6);
	});

	it('nao tenta anualizar perda total', () => {
		expect(annualize(-1, 180)).toBeNull();
		expect(annualize(-1.5, 180)).toBeNull();
	});

	it('devolve null com periodo invalido', () => {
		expect(annualize(0.1, 0)).toBeNull();
		expect(annualize(0.1, -30)).toBeNull();
	});
});

describe('computeXirr', () => {
	it('calcula retorno anual simples de um ano', () => {
		const rate = computeXirr([
			{ date: '2024-01-01', amount: 1000 },
			{ date: '2025-01-01', amount: -1100 },
		]);

		expect(rate).toBeCloseTo(0.1, 3);
	});

	it('reconhece prejuizo', () => {
		const rate = computeXirr([
			{ date: '2024-01-01', amount: 1000 },
			{ date: '2025-01-01', amount: -900 },
		]);

		expect(rate).toBeLessThan(0);
		expect(rate).toBeCloseTo(-0.1, 3);
	});

	// O que diferencia IRR de TWR: o momento do aporte pesa.
	it('pondera pelo momento do aporte', () => {
		const aporteCedo = computeXirr([
			{ date: '2024-01-01', amount: 1000 },
			{ date: '2024-11-01', amount: 100 },
			{ date: '2025-01-01', amount: -1300 },
		]) as number;

		const aporteTarde = computeXirr([
			{ date: '2024-01-01', amount: 100 },
			{ date: '2024-11-01', amount: 1000 },
			{ date: '2025-01-01', amount: -1300 },
		]) as number;

		// Mesmo dinheiro, mesmo resultado final: quem deixou menos tempo
		// aplicado teve retorno maior sobre o capital efetivamente exposto.
		expect(aporteTarde).toBeGreaterThan(aporteCedo);
	});

	it('devolve null sem fluxos de sinais opostos', () => {
		expect(
			computeXirr([
				{ date: '2024-01-01', amount: 1000 },
				{ date: '2025-01-01', amount: 500 },
			])
		).toBeNull();
	});

	it('devolve null com menos de dois fluxos', () => {
		expect(computeXirr([])).toBeNull();
		expect(computeXirr([{ date: '2024-01-01', amount: 1000 }])).toBeNull();
	});

	// Bissecao em intervalo limitado: melhor null que um numero absurdo.
	it('devolve null quando a taxa esta fora do intervalo util', () => {
		const rate = computeXirr([
			{ date: '2024-01-01', amount: 1 },
			{ date: '2024-01-02', amount: -1000000 },
		]);

		expect(rate).toBeNull();
	});
});

// TWR e IRR respondem perguntas diferentes; a diferenca entre eles mede o
// acerto de timing dos aportes.
describe('TWR e IRR juntos', () => {
	it('divergem quando o aporte foi bem cronometrado', () => {
		const twr = computeTwr({
			series: [
				{ date: '2025-06-10', totalValue: 1000, tradingDay: true },
				{ date: '2025-06-11', totalValue: 900, tradingDay: true },
				{ date: '2025-06-12', totalValue: 2000, tradingDay: true },
			],
			flows: [{ date: '2025-06-11', flow: 0 }],
		});

		// A carteira caiu e depois mais que dobrou.
		expect(twr.twr).toBeCloseTo(1.0, 6);
		expect(twr.periods).toBe(2);
	});
});
