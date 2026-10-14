import { termsFor, type TermKey } from 'src/ai/didactic/didactic-glossary';
import { money, pct, pp } from 'src/ai/didactic/didactic-format';
import type {
	DidacticAnswer,
	DidacticLevel,
} from 'src/ai/didactic/didactic.types';
import {
	horizonLabel,
	taxableEquivalentAnnualPct,
} from '../domain/comparison-analysis';
import { CALENDAR_DAYS_PER_YEAR } from '../domain/rate-math';
import type { SimulatedInstrument } from '../domain/simulation';
import type { AssumptionValue, ComparisonResult } from './comparison.types';

/**
 * Explicação didática do comparador de renda fixa
 * (docs/requisitos/ia-didatica.md, RF-9): por que o primeiro colocado rende
 * mais, em reais de hoje, com o peso do IR e da isenção, no nível da pessoa.
 * Só reescreve números que a simulação já calculou e nunca diz o que
 * comprar: compara consequências.
 */

type ComparisonFacts = Pick<ComparisonResult, 'scenario' | 'rows'>;

const byRealDesc = (a: SimulatedInstrument, b: SimulatedInstrument) =>
	b.realAnnualPct - a.realAnnualPct;

/** Valor final, depois do IR, no poder de compra de hoje. */
function todayValue(row: SimulatedInstrument, facts: ComparisonFacts): number {
	const years = facts.scenario.days / CALENDAR_DAYS_PER_YEAR;
	return row.netFinal / (1 + facts.scenario.ipca.valuePct / 100) ** years;
}

function inflationLabel(ipca: AssumptionValue, level: DidacticLevel): string {
	const value = pct(ipca.valuePct, 2);
	if (ipca.source === 'user')
		return `o IPCA que você informou (${value} ao ano)`;
	if (ipca.basis === 'ipca_12m') {
		return level === 'avancado'
			? `IPCA 12m realizado (${value})`
			: `o IPCA dos últimos 12 meses (${value} ao ano), porque a projeção do mercado não estava disponível`;
	}
	return level === 'avancado'
		? `IPCA Focus para o prazo (${value} a.a.)`
		: `a inflação que o mercado projeta para o período (Focus, ${value} ao ano)`;
}

/** Por que o primeiro rende mais que o segundo, na ordem do que mais pesa. */
function driver(
	best: SimulatedInstrument,
	second: SimulatedInstrument,
	facts: ComparisonFacts,
	level: DidacticLevel
): string {
	const irRate = pct(facts.scenario.irRatePct, 1);

	if (best.exempt && !second.exempt) {
		const { principal, years, days, horizonEnd, cdi, ipca } = facts.scenario;
		const equivalent = taxableEquivalentAnnualPct(
			best,
			facts.scenario.irRatePct,
			{
				principal,
				years,
				days,
				horizonEnd,
				cdiPct: cdi.valuePct,
				ipcaPct: ipca.valuePct,
			}
		);
		if (level === 'avancado') {
			return `Isenção de IR: ${best.name} equivale a um papel tributado de ${pct(equivalent, 2)} a.a. brutos neste prazo (IR ${irRate}).`;
		}
		const lowerGross = best.grossAnnualPct < second.grossAnnualPct;
		return `${best.name} não paga imposto de renda, e ${second.name} paga ${irRate} sobre o ganho (${money(second.taxAmount)}).${lowerGross ? ' Mesmo com taxa menor antes do imposto, a isenção faz a diferença.' : ''} Para empatar, um papel com IR teria de render ${pct(equivalent, 2)} ao ano.`;
	}

	if (!best.exempt && second.exempt) {
		return level === 'avancado'
			? `Taxa bruta de ${pct(best.grossAnnualPct, 2)} supera a isenção de ${second.name} mesmo com IR de ${irRate} (${money(best.taxAmount)}).`
			: `${second.name} é isento de IR, mas a taxa de ${best.name} é alta o bastante para compensar os ${money(best.taxAmount)} de imposto (${irRate} sobre o ganho).`;
	}

	if (best.indexer === 'IPCA_PLUS' && second.indexer === 'PREFIXED') {
		return level === 'avancado'
			? `IPCA+ projetado acima do prefixado com a inflação do cenário; inflação acima da projeção amplia a vantagem, abaixo reduz.`
			: `${best.name} paga a inflação mais uma taxa fixa: se a inflação vier maior que a projeção, ele ganha ainda mais. ${second.name} trava a taxa de hoje e não acompanha a inflação.`;
	}
	if (best.indexer === 'PREFIXED' && second.indexer === 'IPCA_PLUS') {
		return level === 'avancado'
			? `Prefixado à frente com a inflação do cenário; inflação acima da projeção favorece o IPCA+.`
			: `${best.name} trava a taxa de hoje e, com a inflação projetada, rende mais. Se a inflação vier acima da projeção, ${second.name} (que acompanha a inflação) pode passar à frente.`;
	}

	return level === 'avancado'
		? `Diferença de taxa: ${pct(best.grossAnnualPct, 2)} vs ${pct(second.grossAnnualPct, 2)} a.a. brutos, mesmo IR (${irRate}).`
		: `A diferença vem da taxa: ${pct(best.grossAnnualPct, 2)} contra ${pct(second.grossAnnualPct, 2)} ao ano antes do imposto, e os dois pagam o mesmo IR neste prazo (${irRate} sobre o ganho).`;
}

export function explainComparison(
	facts: ComparisonFacts,
	level: DidacticLevel
): DidacticAnswer | null {
	const ranked = [...facts.rows].sort(byRealDesc);
	const [best, second] = ranked;
	if (!best) return null;

	const { scenario } = facts;
	const horizon = horizonLabel(scenario.years);
	const inflation = inflationLabel(scenario.ipca, level);
	const bestToday = todayValue(best, facts);
	const anyExempt = facts.rows.some((row) => row.exempt);
	const terms: TermKey[] = [
		'retorno_real',
		'reais_de_hoje',
		'ir_regressivo',
		...(anyExempt ? (['isencao_lci_lca'] as TermKey[]) : []),
		...(scenario.ipca.basis === 'focus' ? (['focus'] as TermKey[]) : []),
	];
	const marking = best.note ? [best.note] : [];

	if (best.realAnnualPct <= 0) {
		return {
			level,
			answer:
				level === 'avancado'
					? `Nenhuma opção com retorno real positivo; a menos negativa é ${best.name} (${pct(best.realAnnualPct, 2)} a.a.).`
					: `Com ${inflation}, nenhuma opção rende acima da inflação em ${horizon}. A que perde menos é ${best.name}.`,
			meaning:
				level === 'avancado'
					? null
					: `Os ${money(scenario.principal)} aplicados viram ${money(best.netFinal)} depois do imposto, mas isso compra o equivalente a ${money(bestToday)} hoje: o dinheiro cresce menos que os preços.`,
			whyItMatters: null,
			options: marking,
			terms: termsFor(terms, level),
			followUps: [],
		};
	}

	if (!second) {
		return {
			level,
			answer: `${best.name} rende ${pct(best.realAnnualPct, 2)} ao ano acima da inflação, depois do imposto.`,
			meaning: `Os ${money(scenario.principal)} viram ${money(best.netFinal)} em ${horizon}, ou ${money(bestToday)} em reais de hoje, usando ${inflation}.`,
			whyItMatters: null,
			options: marking,
			terms: termsFor(terms, level),
			followUps: [],
		};
	}

	const secondToday = todayValue(second, facts);
	const diffToday = bestToday - secondToday;
	const why = driver(best, second, facts, level);

	if (level === 'iniciante') {
		return {
			level,
			answer: `Em ${horizon}, ${best.name} deixa mais dinheiro no seu bolso: ${money(diffToday)} a mais que ${second.name}, já descontados o imposto e a inflação.`,
			meaning: `"Descontar a inflação" é converter o valor futuro para o que ele compra hoje. Usamos ${inflation}. Os ${money(scenario.principal)} aplicados em ${best.name} viram ${money(best.netFinal)} depois do imposto, que compram o mesmo que ${money(bestToday)} hoje.`,
			whyItMatters: why,
			options: marking,
			terms: termsFor(terms, level),
			followUps: [],
		};
	}

	if (level === 'intermediario') {
		return {
			level,
			answer: `${best.name} tem o maior retorno real: ${pct(best.realAnnualPct, 2)} ao ano, contra ${pct(second.realAnnualPct, 2)} de ${second.name}. Em reais de hoje, são ${money(diffToday)} a mais em ${horizon}.`,
			meaning: `Retorno real é o líquido de IR descontado ${inflation}. Em ${best.name}: ${pct(best.grossAnnualPct, 2)} bruto, ${pct(best.netAnnualPct, 2)} líquido (o IR tira ${pp(best.taxDragPp, 2)} por ano) e ${pct(best.realAnnualPct, 2)} real.`,
			whyItMatters: why,
			options: marking,
			terms: termsFor(terms, level),
			followUps: [],
		};
	}

	const line = (row: SimulatedInstrument) =>
		`${row.name}: bruto ${pct(row.grossAnnualPct, 2)}, líq. ${pct(row.netAnnualPct, 2)}, real ${pct(row.realAnnualPct, 2)}, IR ${money(row.taxAmount)}`;
	return {
		level,
		answer: `${best.name} lidera em retorno real (${pct(best.realAnnualPct, 2)} a.a. vs ${pct(second.realAnnualPct, 2)} de ${second.name}); ${money(diffToday)} a valor presente real em ${horizon}.`,
		meaning: `${ranked.slice(0, 4).map(line).join('; ')}. Deflator: ${inflation}.`,
		whyItMatters: why,
		options: marking,
		terms: termsFor(terms, level),
		followUps: [],
	};
}
