import {
	annualize,
	computeTwr,
	computeDailyReturns,
	computeXirr,
	costOfPositionsWithoutTrades,
	cumulativeReturns,
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
			series: [
				trading('2025-06-12', 1210),
				trading('2025-06-10', 1000),
				trading('2025-06-11', 1100),
			],
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

describe('cumulativeReturns', () => {
	const trading = (date: string, totalValue: number) => ({
		date,
		totalValue,
		tradingDay: true,
	});

	it('encadeia os retornos diarios a partir da base zero', () => {
		const series = cumulativeReturns(
			[
				{ date: '2025-06-11', value: 0.1 },
				{ date: '2025-06-12', value: -0.1 },
			],
			'2025-06-10'
		);

		expect(series.map((point) => point.date)).toEqual([
			'2025-06-10',
			'2025-06-11',
			'2025-06-12',
		]);
		expect(series[0].value).toBe(0);
		expect(series[1].value).toBeCloseTo(0.1, 6);
		// 1.1 * 0.9 - 1: queda de 10% depois de alta de 10% nao volta a zero.
		expect(series[2].value).toBeCloseTo(-0.01, 6);
	});

	// O defeito que motivou a serie: aporte e compra-e-venda apareciam como
	// rentabilidade no grafico de evolucao. Ajustado por fluxo, somem.
	it('aporte e venda nao viram pico na curva', () => {
		const { returns } = computeDailyReturns({
			series: [
				trading('2025-06-10', 1000),
				trading('2025-06-11', 5000),
				trading('2025-06-12', 1000),
			],
			flows: [
				{ date: '2025-06-11', flow: 4000 },
				{ date: '2025-06-12', flow: -4000 },
			],
		});
		const series = cumulativeReturns(returns, '2025-06-10');

		expect(series.every((point) => Math.abs(point.value) < 1e-9)).toBe(true);
	});

	it('serie vazia continua vazia, mesmo com base', () => {
		expect(cumulativeReturns([], '2025-06-10')).toEqual([]);
	});
});

describe('computeDailyReturns: só encadeia dias comparáveis (TRA-279)', () => {
	const day = (
		date: string,
		totalValue: number,
		investedValue: number | undefined,
		staleSymbols: string[] = []
	) => ({ date, totalValue, investedValue, staleSymbols, tradingDay: true });

	const twrOf = (series: ReturnType<typeof day>[], flows: any[] = []) =>
		computeTwr({ series, flows });

	// O caso real: snapshot das 19:30 rodou com a carteira vazia no meio de
	// uma reimportação e gravou R$ 0. Encadeado, o TWR ficava em -100% para
	// sempre, porque tudo multiplicado por zero continua zero.
	it('dia zerado no meio da série não leva o TWR a -100%', () => {
		const result = twrOf([
			day('2026-10-01', 1000, 1000),
			day('2026-10-02', 1100, 1000),
			day('2026-10-05', 0, 0),
			day('2026-10-06', 1100, 1000),
			day('2026-10-07', 1210, 1000),
		]);

		expect(result.twr).toBeCloseTo(0.21, 6);
	});

	// A reconstrução sem fechamento grava o custo; isso não é rendimento 0%.
	it('ignora pontos só a custo e mede a partir do primeiro dia a mercado', () => {
		const result = twrOf([
			day('2025-01-07', 3000, 3000, ['PETR4']),
			day('2025-01-08', 3000, 3000, ['PETR4']),
			day('2026-10-01', 1000, 900),
			day('2026-10-02', 1050, 900),
		]);

		expect(result.twr).toBeCloseTo(0.05, 6);
		expect(result.measuredFrom).toBe('2026-10-01');
		expect(result.measuredTo).toBe('2026-10-02');
	});

	// Ativo que ganha cotação salta do custo para o mercado: reavaliação.
	it('não mede retorno quando muda o conjunto de símbolos sem cotação', () => {
		const result = twrOf([
			day('2026-09-25', 12078, 11933, ['BBAS3', 'LCA']),
			day('2026-09-28', 12637, 11933, ['LCA']),
			day('2026-09-29', 12700, 11933, ['LCA']),
		]);

		expect(result.twr).toBeCloseTo(12700 / 12637 - 1, 6);
	});

	// Posição que entrou pelo relatório consolidado, sem nota de negociação.
	it('custo que muda sem negociação no dia não vira rendimento', () => {
		const result = twrOf([
			day('2026-09-10', 5000, 5000),
			day('2026-09-11', 12000, 11900),
			day('2026-09-14', 12120, 11900),
		]);

		expect(result.twr).toBeCloseTo(0.01, 6);
	});

	it('com negociação no dia, o custo muda e o fluxo é descontado', () => {
		const result = twrOf(
			[day('2026-09-10', 1000, 1000), day('2026-09-11', 1600, 1500)],
			[{ date: '2026-09-11', flow: 500 }]
		);

		expect(result.twr).toBeCloseTo(0.1, 6);
	});

	it('linha sem custo registrado não se mistura com as demais', () => {
		const result = twrOf([
			day('2025-12-30', 5015, 5015),
			day('2025-12-31', 11933, undefined),
			day('2026-01-02', 5015, 5015),
			day('2026-01-05', 5100, 5015),
		]);

		expect(result.twr).toBeCloseTo(5100 / 5015 - 1, 6);
	});

	// Série no formato da carteira que expôs o problema: anos a custo, um
	// ponto avulso, um dia zerado, reavaliação e cotação errada de cripto.
	it('série real da TRA-279 sai com rentabilidade plausível, não -100%', () => {
		const lca = '25F08539417';
		const result = twrOf([
			day('2025-07-21', 3048, 3048, ['PETR4', 'VBBR3']),
			day('2025-12-31', 11933, undefined),
			day('2026-09-11', 5766, 5766, ['PETR4', 'VBBR3']),
			day('2026-09-14', 0, 0),
			day('2026-09-15', 12078, 11933, ['BBAS3', lca]),
			day('2026-09-16', 12078, 11933, ['BBAS3', lca]),
			day('2026-09-28', 12637, 11933, [lca, 'LUNC']),
			day('2026-09-29', 39756, 11933, [lca]),
			day('2026-09-30', 39875, 11933, [lca]),
			day('2026-10-01', 12767, 11933, [lca, 'BTTC']),
			day('2026-10-02', 13000, 11933, [lca, 'BTTC']),
			day('2026-10-07', 13438, 11933, [lca, 'BTTC']),
		]);

		expect(result.twr).not.toBeNull();
		expect(result.twr as number).toBeGreaterThan(-0.05);
		expect(result.twr as number).toBeLessThan(0.1);
	});
});

describe('costOfPositionsWithoutTrades (TRA-279)', () => {
	// O caso real: CEBR3, GOLD11 e a LCA vieram do relatório consolidado, sem
	// nota. Fora do aportado, o valor delas virava "o mercado rendeu +170%".
	it('soma o custo de entrada só das posições sem negociação', () => {
		const cost = costOfPositionsWithoutTrades(
			[
				{ symbol: 'BBAS3', quantity: 69, price: 21.92 },
				{ symbol: 'CEBR3', quantity: 20, price: 26.79 },
				{ symbol: 'GOLD11', quantity: 3, price: 24.77 },
				{ symbol: '25F08539417', quantity: 1, price: 1068.35 },
			],
			new Set(['BBAS3'])
		);

		expect(cost).toBeCloseTo(20 * 26.79 + 3 * 24.77 + 1068.35, 2);
	});

	it('casa símbolo sem diferenciar maiúscula', () => {
		expect(
			costOfPositionsWithoutTrades(
				[{ symbol: 'petr4', quantity: 10, price: 30 }],
				new Set(['PETR4'])
			)
		).toBe(0);
	});

	it('ignora posição zerada ou sem preço de entrada', () => {
		expect(
			costOfPositionsWithoutTrades(
				[
					{ symbol: 'BTTC', quantity: 65, price: 0 },
					{ symbol: 'VALE3', quantity: 0, price: 60 },
				],
				new Set()
			)
		).toBe(0);
	});
});
