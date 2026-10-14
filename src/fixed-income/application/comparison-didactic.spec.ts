import type { DidacticLevel } from 'src/ai/didactic/didactic.types';
import type { Instrument } from '../domain/instrument';
import { type Scenario, simulateInstrument } from '../domain/simulation';
import { explainComparison } from './comparison-didactic';
import type { AssumptionValue, ComparisonResult } from './comparison.types';

const LEVELS: DidacticLevel[] = ['iniciante', 'intermediario', 'avancado'];

const scenario: Scenario = {
	principal: 10_000,
	years: 3,
	days: 1095,
	cdiPct: 13.65,
	ipcaPct: 4.2,
	horizonEnd: '2029-10-13',
};

const instrument = (
	id: string,
	name: string,
	kind: Instrument['kind'],
	indexer: Instrument['indexer'],
	ratePct: number
): Instrument => ({ id, name, kind, family: 'BANK', indexer, ratePct });

const LCI = instrument('lci', 'LCI 92% do CDI', 'LCI', 'PERCENT_CDI', 92);
const CDB = instrument('cdb', 'CDB 105% do CDI', 'CDB', 'PERCENT_CDI', 105);
const CDB_HIGH = instrument(
	'cdb2',
	'CDB 125% do CDI',
	'CDB',
	'PERCENT_CDI',
	125
);

const facts = (
	instruments: Instrument[],
	ipca: AssumptionValue = {
		valuePct: 4.2,
		source: 'market',
		asOf: '2026-10-09',
		basis: 'focus',
	},
	ipcaPct = 4.2
): Pick<ComparisonResult, 'scenario' | 'rows'> => {
	const rows = instruments.map((item) =>
		simulateInstrument(item, { ...scenario, ipcaPct })
	);
	return {
		scenario: {
			principal: scenario.principal,
			years: scenario.years,
			days: scenario.days,
			horizonEnd: scenario.horizonEnd,
			irRatePct: 15,
			cdi: { valuePct: 13.65, source: 'market' },
			ipca,
		},
		rows: rows.map((row) => ({ ...row, isBest: false })),
	};
};

const text = (answer: NonNullable<ReturnType<typeof explainComparison>>) =>
	[
		answer.answer,
		answer.meaning,
		answer.whyItMatters,
		...answer.options,
		...answer.terms.map((term) => term.definition),
	]
		.filter(Boolean)
		.join(' ');

describe('explainComparison', () => {
	it.each(LEVELS)(
		'%s: no internal keys, no US decimals, no buy/sell order',
		(level) => {
			const answer = explainComparison(facts([LCI, CDB]), level)!;
			const all = text(answer);

			expect(answer.level).toBe(level);
			expect(all).not.toMatch(
				/\b(PERCENT_CDI|IPCA_PLUS|ipca_12m|focus|undefined|NaN)\b/
			);
			expect(all).not.toMatch(/\d\.\d+%/);
			expect(all).not.toMatch(/\b(compre|recomendamos|você deve|aplique)\b/i);
		}
	);

	it('beginner: exempt LCI beats a CDB, explained in reais of today', () => {
		const answer = explainComparison(facts([CDB, LCI]), 'iniciante')!;

		expect(answer.answer).toMatch(
			/^Em 3 anos, LCI 92% do CDI deixa mais dinheiro no seu bolso: R\$\s[\d.,]+ a mais que CDB 105% do CDI, já descontados o imposto e a inflação\.$/
		);
		expect(answer.meaning).toContain('Focus, 4,2% ao ano');
		expect(answer.whyItMatters).toContain(
			'LCI 92% do CDI não paga imposto de renda'
		);
		expect(answer.whyItMatters).toContain('Mesmo com taxa menor');
		expect(answer.whyItMatters).toContain('Para empatar, um papel com IR');
		expect(answer.terms.map((term) => term.term)).toEqual([
			'Retorno real',
			'Reais de hoje',
			'IR regressivo',
			'Isenção de LCI e LCA',
			'Projeção Focus',
		]);
	});

	it('intermediate: a taxed CDB with a high rate beats the exemption', () => {
		const answer = explainComparison(facts([LCI, CDB_HIGH]), 'intermediario')!;

		expect(answer.answer).toContain('CDB 125% do CDI tem o maior retorno real');
		expect(answer.meaning).toContain('bruto');
		expect(answer.meaning).toContain('o IR tira');
		expect(answer.whyItMatters).toContain(
			'LCI 92% do CDI é isento de IR, mas a taxa de CDB 125% do CDI é alta o bastante'
		);
	});

	it('two exempt papers: the difference is only the rate, never IR', () => {
		const LCA = instrument('lca', 'LCA 90% do CDI', 'LCA', 'PERCENT_CDI', 90);
		const answer = explainComparison(facts([LCA, LCI]), 'iniciante')!;

		expect(answer.whyItMatters).toContain(
			'Os dois são isentos de imposto de renda'
		);
		expect(answer.whyItMatters).not.toContain('pagam o mesmo IR');
	});

	it('advanced: technical lines per instrument and the deflator', () => {
		const answer = explainComparison(facts([LCI, CDB]), 'avancado')!;

		expect(answer.answer).toContain('a valor presente real em 3 anos');
		expect(answer.meaning).toContain('LCI 92% do CDI: bruto');
		expect(answer.meaning).toContain(
			'Deflator: IPCA Focus para o prazo (4,2% a.a.)'
		);
		expect(answer.whyItMatters).toMatch(/equivale a um papel tributado de/);
	});

	it('says which inflation it used when Focus was missing or typed', () => {
		const realized = explainComparison(
			facts([LCI, CDB], {
				valuePct: 4.2,
				source: 'market',
				basis: 'ipca_12m',
			}),
			'iniciante'
		)!;
		const typed = explainComparison(
			facts([LCI, CDB], { valuePct: 4.2, source: 'user' }),
			'iniciante'
		)!;

		expect(realized.meaning).toContain('IPCA dos últimos 12 meses');
		expect(realized.terms.map((term) => term.term)).not.toContain(
			'Projeção Focus'
		);
		expect(typed.meaning).toContain('o IPCA que você informou');
	});

	it('when nothing beats inflation, says so and shows the loss of purchasing power', () => {
		const answer = explainComparison(
			facts([LCI, CDB], { valuePct: 20, source: 'user' }, 20),
			'iniciante'
		)!;

		expect(answer.answer).toContain('nenhuma opção rende acima da inflação');
		expect(answer.meaning).toContain('o dinheiro cresce menos que os preços');
	});

	it('no rows means no explanation', () => {
		expect(explainComparison(facts([]), 'iniciante')).toBeNull();
	});
});
