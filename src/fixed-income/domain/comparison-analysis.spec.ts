import {
	buildAnalysis,
	taxableEquivalentAnnualPct,
} from './comparison-analysis';
import type { Instrument } from './instrument';
import { type Scenario, simulateInstrument } from './simulation';

const scenario: Scenario = {
	principal: 10_000,
	years: 3,
	days: 1095,
	cdiPct: 13.65,
	ipcaPct: 4.5,
	horizonEnd: '2029-10-04',
};

const make = (overrides: Partial<Instrument>) =>
	simulateInstrument(
		{
			id: overrides.id ?? overrides.name ?? 'x',
			name: 'x',
			kind: 'CDB',
			family: 'BANK',
			indexer: 'PERCENT_CDI',
			ratePct: 100,
			...overrides,
		},
		scenario
	);

const cdb110 = make({
	id: 'cdb',
	name: 'CDB 110% do CDI',
	kind: 'CDB',
	ratePct: 110,
});
const lci95 = make({
	id: 'lci',
	name: 'LCI 95% do CDI',
	kind: 'LCI',
	ratePct: 95,
});
const reference = make({
	id: 'ref',
	name: '100% do CDI',
	kind: 'REFERENCIA',
	family: 'REFERENCE',
	ratePct: 100,
});
const pre = make({
	id: 'pre',
	name: 'Tesouro Prefixado 2031',
	kind: 'TESOURO',
	family: 'TESOURO',
	indexer: 'PREFIXED',
	ratePct: 14.07,
});
const ipcaPlus = make({
	id: 'ipca',
	name: 'Tesouro IPCA+ 2035',
	kind: 'TESOURO',
	family: 'TESOURO',
	indexer: 'IPCA_PLUS',
	ratePct: 7.55,
});

describe('buildAnalysis', () => {
	it('sem papéis, diz que não há o que comparar', () => {
		expect(buildAnalysis([], scenario)).toEqual({
			headline: 'Nenhum papel para comparar neste cenário.',
			points: [],
		});
	});

	it('manchete cita o cenário, o vencedor e os dois seguintes com os números da tabela', () => {
		const { headline } = buildAnalysis([cdb110, lci95, reference], scenario);
		expect(headline).toBe(
			'Com CDI a 13,65% e IPCA a 4,50% ao ano, em 3 anos, o melhor retorno real é CDB 110% do CDI: 8,23% ao ano acima da inflação, contra 8,06% de LCI 95% do CDI e 6,99% de 100% do CDI.'
		);
	});

	it('com um papel só, a manchete não inventa comparação', () => {
		const { headline } = buildAnalysis([cdb110], scenario);
		expect(headline).toContain('o melhor retorno real é CDB 110% do CDI');
		expect(headline).not.toContain('contra');
	});

	it('quando nada vence a inflação, diz isso em vez de eleger vencedor', () => {
		const lowInflation = { ...scenario, ipcaPct: 30 };
		const row = simulateInstrument(
			{
				id: 'cdb',
				name: 'CDB 100% do CDI',
				kind: 'CDB',
				family: 'BANK',
				indexer: 'PERCENT_CDI',
				ratePct: 100,
			},
			lowInflation
		);
		const { headline, points } = buildAnalysis([row], lowInflation);
		expect(headline).toContain('nenhuma opção rende acima da inflação');
		expect(points[0].tone).toBe('warning');
		expect(points[0].text).toContain('perde poder de compra');
	});

	it('compara o melhor isento com o melhor tributado e traduz a isenção em % do CDI', () => {
		const { points } = buildAnalysis([cdb110, lci95, reference], scenario);
		const exemption = points[0];
		expect(exemption.tone).toBe('info'); // CDB 110% ainda ganha da LCI 95%
		expect(exemption.text).toContain('LCI 95% do CDI');
		expect(exemption.text).toContain('fica atrás de CDB 110% do CDI');
		expect(exemption.text).toContain('IR de 15,00%');
		// O IR incide sobre o ganho total de 3 anos, não sobre a taxa anual: a
		// conta "95 ÷ 0,85 = 111,8%" superestima. O equivalente exato é ~108,7%.
		expect(exemption.text).toMatch(/108,\d\d% do CDI/);
		expect(exemption.text).not.toMatch(/111,\d\d% do CDI/);
	});

	it('marca a isenção como vantagem quando o isento vence', () => {
		const strongLci = make({
			id: 'lci',
			name: 'LCI 100% do CDI',
			kind: 'LCI',
			ratePct: 100,
		});
		const { points } = buildAnalysis([cdb110, strongLci], scenario);
		expect(points[0].tone).toBe('positive');
		expect(points[0].text).toContain('supera');
	});

	it('ponto de virada entre prefixado e IPCA+ usa a inflação implícita das duas taxas', () => {
		const { points } = buildAnalysis([pre, ipcaPlus, reference], scenario);
		const breakeven = points.find((point) =>
			point.text.startsWith('Ponto de virada')
		);
		expect(breakeven?.text).toContain('IPCA a 6,06% ao ano');
		// IPCA de 4,5% < 6,06%: o prefixado fica à frente.
		expect(breakeven?.text).toContain('Tesouro Prefixado 2031 fica à frente');
	});

	it('a taxa de empate faz o IPCA+ ultrapassar o prefixado quando a inflação passa dela', () => {
		const highInflation = { ...scenario, ipcaPct: 8 };
		const rows = [pre, ipcaPlus].map((row) =>
			simulateInstrument(row, highInflation)
		);
		const { points } = buildAnalysis(rows, highInflation);
		expect(points[0].text).toContain('Tesouro IPCA+ 2035 fica à frente');
	});

	it('avisa quando algum papel perde para a inflação', () => {
		const inflation = { ...scenario, ipcaPct: 16 };
		const rows = [cdb110, reference].map((row) =>
			simulateInstrument(row, inflation)
		);
		const { points } = buildAnalysis(rows, inflation);
		const warning = points.find((point) => point.tone === 'warning');
		expect(warning?.text).toContain('rendem menos que a inflação');
	});

	it('mostra o ganho sobre a referência do CDI quando ninguém perde para a inflação', () => {
		const { points } = buildAnalysis([cdb110, reference], scenario);
		expect(points.at(-1)?.tone).toBe('positive');
		expect(points.at(-1)?.text).toContain('a mais que 100% do CDI');
	});

	it('só com a referência na tabela, não finge comparar com "outros papéis"', () => {
		const { points, headline } = buildAnalysis([reference], scenario);
		expect(headline).toContain('o melhor retorno real é 100% do CDI');
		expect(points).toEqual([]);
	});

	it('no máximo três pontos', () => {
		const { points } = buildAnalysis(
			[cdb110, lci95, reference, pre, ipcaPlus],
			scenario
		);
		expect(points.length).toBeLessThanOrEqual(3);
	});
});

describe('taxableEquivalentAnnualPct', () => {
	it('um isento com IR de 15% equivale a um tributado que rende bruto mais que ele', () => {
		const equivalent = taxableEquivalentAnnualPct(lci95, 15, scenario);
		expect(equivalent).toBeGreaterThan(lci95.grossAnnualPct);
		// Conferência: o tributado a essa taxa entrega o mesmo valor final.
		const taxable = simulateInstrument(
			{
				id: 't',
				name: 't',
				kind: 'CDB',
				family: 'BANK',
				indexer: 'PREFIXED',
				ratePct: equivalent,
			},
			scenario
		);
		expect(taxable.netFinal).toBeCloseTo(lci95.netFinal, 6);
	});
});
