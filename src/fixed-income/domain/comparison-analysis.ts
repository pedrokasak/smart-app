import {
	CALENDAR_DAYS_PER_YEAR,
	annualPctToPercentOfCdi,
	breakevenInflationPct,
} from './rate-math';
import type { Scenario, SimulatedInstrument } from './simulation';

export interface AnalysisPoint {
	tone: 'positive' | 'warning' | 'info';
	text: string;
}

export interface Analysis {
	headline: string;
	points: AnalysisPoint[];
}

const MAX_POINTS = 3;

export function formatPct(value: number): string {
	return value.toLocaleString('pt-BR', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

function horizonLabel(years: number): string {
	const text = Number.isInteger(years)
		? String(years)
		: years.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
	return `${text} ${years === 1 ? 'ano' : 'anos'}`;
}

const byRealDesc = (a: SimulatedInstrument, b: SimulatedInstrument) =>
	b.realAnnualPct - a.realAnnualPct;

function headlineOf(ranked: SimulatedInstrument[], scenario: Scenario): string {
	const [first, second, third] = ranked;
	const context = `Com CDI a ${formatPct(scenario.cdiPct)}% e IPCA a ${formatPct(scenario.ipcaPct)}% ao ano, em ${horizonLabel(scenario.years)}`;

	if (first.realAnnualPct <= 0) {
		return `${context}, nenhuma opção rende acima da inflação: a menos distante é ${first.name}, com retorno real de ${formatPct(first.realAnnualPct)}% ao ano.`;
	}

	let text = `${context}, o melhor retorno real é ${first.name}: ${formatPct(first.realAnnualPct)}% ao ano acima da inflação`;
	if (second)
		text += `, contra ${formatPct(second.realAnnualPct)}% de ${second.name}`;
	if (third) text += ` e ${formatPct(third.realAnnualPct)}% de ${third.name}`;
	return `${text}.`;
}

/**
 * Quanto um papel TRIBUTADO teria de render por ano, bruto, para entregar o
 * mesmo valor final de um isento neste prazo.
 */
export function taxableEquivalentAnnualPct(
	exempt: SimulatedInstrument,
	taxableIrRatePct: number,
	scenario: Scenario
): number {
	const years = scenario.days / CALENDAR_DAYS_PER_YEAR;
	const exemptGrowth = exempt.netFinal / scenario.principal;
	const taxableGrowth = 1 + (exemptGrowth - 1) / (1 - taxableIrRatePct / 100);
	return (taxableGrowth ** (1 / years) - 1) * 100;
}

function exemptionPoint(
	rows: SimulatedInstrument[],
	scenario: Scenario
): AnalysisPoint | null {
	const exempt = rows
		.filter((row) => row.exempt && row.family === 'BANK')
		.sort(byRealDesc)[0];
	const taxable = rows
		.filter((row) => !row.exempt && row.family === 'BANK')
		.sort(byRealDesc)[0];
	if (!exempt || !taxable) return null;

	const irRatePct = taxable.irRatePct;
	const equivalent = taxableEquivalentAnnualPct(exempt, irRatePct, scenario);
	const equivalentCdi = annualPctToPercentOfCdi(scenario.cdiPct, equivalent);
	const wins = exempt.realAnnualPct >= taxable.realAnnualPct;

	return {
		tone: wins ? 'positive' : 'info',
		text: `${exempt.name} (${formatPct(exempt.realAnnualPct)}% real) ${wins ? 'supera' : 'fica atrás de'} ${taxable.name} (${formatPct(taxable.realAnnualPct)}% real): com IR de ${formatPct(irRatePct)}% neste prazo, a isenção equivale a um papel tributado de ${formatPct(equivalent)}% ao ano, ou ${formatPct(equivalentCdi)}% do CDI.`,
	};
}

function breakevenPoint(
	rows: SimulatedInstrument[],
	scenario: Scenario
): AnalysisPoint | null {
	const prefixed = rows.find(
		(row) => row.family === 'TESOURO' && row.indexer === 'PREFIXED'
	);
	const ipcaPlus = rows.find(
		(row) => row.family === 'TESOURO' && row.indexer === 'IPCA_PLUS'
	);
	if (!prefixed || !ipcaPlus) return null;

	const breakeven = breakevenInflationPct(prefixed.ratePct, ipcaPlus.ratePct);
	const leader =
		prefixed.realAnnualPct >= ipcaPlus.realAnnualPct ? prefixed : ipcaPlus;
	return {
		tone: 'warning',
		text: `Ponto de virada: ${prefixed.name} e ${ipcaPlus.name} rendem igual com IPCA a ${formatPct(breakeven)}% ao ano. Com o IPCA em ${formatPct(scenario.ipcaPct)}%, ${leader.name} fica à frente.`,
	};
}

function inflationOrBenchmarkPoint(
	rows: SimulatedInstrument[],
	ranked: SimulatedInstrument[]
): AnalysisPoint | null {
	const losing = rows.filter((row) => row.realAnnualPct < 0);
	if (losing.length > 0) {
		return {
			tone: 'warning',
			text: `${losing.map((row) => row.name).join(', ')} ${losing.length === 1 ? 'rende' : 'rendem'} menos que a inflação no prazo: o dinheiro perde poder de compra.`,
		};
	}

	const reference = rows.find((row) => row.family === 'REFERENCE');
	const winner = ranked[0];
	// Só a referência na tabela: não há "outros papéis" a comparar com ela.
	if (!reference || rows.length < 2) return null;
	if (winner.id === reference.id) {
		return {
			tone: 'info',
			text: `Nenhum dos outros papéis bate ${reference.name} no retorno real deste cenário.`,
		};
	}
	return {
		tone: 'positive',
		text: `${winner.name} rende ${formatPct(winner.realAnnualPct - reference.realAnnualPct)} p.p. de retorno real a mais que ${reference.name} (${formatPct(reference.realAnnualPct)}% real).`,
	};
}

/**
 * Leitura do cenário feita só com regra. É a mesma base que alimenta o
 * trackerr-ia — o texto da IA nunca pode discordar da tabela porque os dois
 * saem dos mesmos números — e é o que aparece quando a IA não responde.
 */
export function buildAnalysis(
	rows: SimulatedInstrument[],
	scenario: Scenario
): Analysis {
	if (rows.length === 0) {
		return {
			headline: 'Nenhum papel para comparar neste cenário.',
			points: [],
		};
	}

	const ranked = [...rows].sort(byRealDesc);
	const points = [
		exemptionPoint(rows, scenario),
		breakevenPoint(rows, scenario),
		inflationOrBenchmarkPoint(rows, ranked),
	].filter((point): point is AnalysisPoint => point !== null);

	return {
		headline: headlineOf(ranked, scenario),
		points: points.slice(0, MAX_POINTS),
	};
}
