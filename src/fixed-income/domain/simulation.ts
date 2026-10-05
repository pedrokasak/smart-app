import { daysBetween } from './dates';
import { isTaxExempt, regressiveTaxRatePct } from './fixed-income-tax';
import type { Instrument } from './instrument';
import {
	CALENDAR_DAYS_PER_YEAR,
	cdiPlusSpreadToAnnualPct,
	ipcaPlusToAnnualPct,
	percentOfCdiToAnnualPct,
	realReturnPct,
} from './rate-math';

/**
 * Diferença de vencimento acima da qual vender no fim do prazo já pega o
 * título longe do vencimento, a preço de mercado (marcação a mercado).
 */
const MARK_TO_MARKET_TOLERANCE_DAYS = 30;

export interface Scenario {
	/** Valor aplicado, em R$. */
	principal: number;
	/** Prazo em anos (aceita fração: 0,5 = seis meses). */
	years: number;
	/** Prazo em dias corridos: base da faixa do IR e da capitalização. */
	days: number;
	cdiPct: number;
	ipcaPct: number;
	/** Fim do prazo (YYYY-MM-DD), para comparar com o vencimento dos títulos. */
	horizonEnd: string;
}

export interface SimulatedInstrument extends Instrument {
	exempt: boolean;
	grossAnnualPct: number;
	/** Alíquota do IR aplicada ao ganho (0 nos isentos). */
	irRatePct: number;
	/** Quanto o IR tira da taxa anual, em pontos percentuais. */
	taxDragPp: number;
	netAnnualPct: number;
	realAnnualPct: number;
	grossFinal: number;
	taxAmount: number;
	netFinal: number;
	tag: string;
	note?: string;
}

export function daysFromYears(years: number): number {
	return Math.round(years * CALENDAR_DAYS_PER_YEAR);
}

export function grossAnnualPctOf(
	instrument: Instrument,
	scenario: Scenario
): number {
	switch (instrument.indexer) {
		case 'PERCENT_CDI':
			return percentOfCdiToAnnualPct(scenario.cdiPct, instrument.ratePct);
		case 'CDI_PLUS':
			return cdiPlusSpreadToAnnualPct(scenario.cdiPct, instrument.ratePct);
		case 'PREFIXED':
			return instrument.ratePct;
		case 'IPCA_PLUS':
			return ipcaPlusToAnnualPct(scenario.ipcaPct, instrument.ratePct);
	}
}

function tagOf(instrument: Instrument, exempt: boolean): string {
	if (instrument.family === 'REFERENCE') return 'Referência';
	if (instrument.family === 'TESOURO') {
		if (instrument.indexer === 'PREFIXED') return 'Travar taxa';
		if (instrument.indexer === 'IPCA_PLUS') return 'Protege da inflação';
		return 'Liquidez diária';
	}
	if (exempt) return 'Isento de IR';
	return instrument.kind === 'DEBENTURE'
		? 'Crédito privado'
		: 'Crédito bancário';
}

function noteOf(
	instrument: Instrument,
	scenario: Scenario
): string | undefined {
	if (
		instrument.family !== 'TESOURO' ||
		instrument.indexer === 'CDI_PLUS' ||
		!instrument.maturityDate
	) {
		return undefined;
	}
	const gap = daysBetween(scenario.horizonEnd, instrument.maturityDate);
	if (gap <= MARK_TO_MARKET_TOLERANCE_DAYS) return undefined;
	return `Vence em ${instrument.maturityDate.slice(0, 4)}: vender antes do vencimento pode render menos que a taxa contratada (marcação a mercado).`;
}

/**
 * Aplica o cenário a um papel. O IR incide UMA vez sobre o ganho total do
 * prazo — é assim que o resgate é tributado —, e só depois o ganho líquido
 * vira taxa anual. Descontar o IR da taxa anual (`taxa × (1 − IR)`) erra o
 * líquido, e o erro cresce com o prazo.
 */
export function simulateInstrument(
	instrument: Instrument,
	scenario: Scenario
): SimulatedInstrument {
	const exempt = isTaxExempt(instrument.kind);
	const grossAnnualPct = grossAnnualPctOf(instrument, scenario);
	const years = scenario.days / CALENDAR_DAYS_PER_YEAR;

	const growth = (1 + grossAnnualPct / 100) ** years;
	const grossFinal = scenario.principal * growth;
	const grossGain = grossFinal - scenario.principal;

	const irRatePct = exempt ? 0 : regressiveTaxRatePct(scenario.days);
	const taxAmount = grossGain * (irRatePct / 100);
	const netFinal = grossFinal - taxAmount;

	const netAnnualPct =
		((netFinal / scenario.principal) ** (1 / years) - 1) * 100;

	return {
		...instrument,
		exempt,
		grossAnnualPct,
		irRatePct,
		taxDragPp: grossAnnualPct - netAnnualPct,
		netAnnualPct,
		realAnnualPct: realReturnPct(netAnnualPct, scenario.ipcaPct),
		grossFinal,
		taxAmount,
		netFinal,
		tag: tagOf(instrument, exempt),
		note: noteOf(instrument, scenario),
	};
}
