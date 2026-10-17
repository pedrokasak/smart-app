import { inflationOverPeriod } from 'src/macro-indicators/domain/compounding';
import { isTradingDay } from 'src/portfolio/history/trading-calendar';
import { addDays, daysBetween } from './dates';
import {
	iofRatePct,
	isTaxExempt,
	regressiveTaxRatePct,
} from './fixed-income-tax';
import { BUSINESS_DAYS_PER_YEAR } from './rate-math';
import type {
	FixedIncomePosition,
	FixedIncomeValuation,
	IndexRatePoint,
	IndexSeries,
} from './fixed-income.types';

/**
 * Marcação na curva de uma posição de renda fixa (TRA-230). Função pura: as
 * séries chegam prontas, nada aqui busca dado.
 *
 * Convenções:
 * - Rende nos dias úteis de `[aplicação, data de marcação)`: o CDI de um dia
 *   remunera a noite até o dia útil seguinte, então o dia da aplicação conta
 *   e o da marcação não.
 * - Fator diário do CDI arredondado na 8ª casa, como nas calculadoras de
 *   mercado; o valor final é arredondado em centavos.
 * - `CDI_PLUS` (Tesouro Selic) usa o CDI como proxy da Selic, a mesma
 *   escolha do comparador; a diferença entre os dois é de centésimos ao ano.
 * - IPCA entra pró-rata por dias corridos no mês parcial
 *   (`inflationOverPeriod`), e o mês ainda sem IPCA usa o último publicado.
 *   O Tesouro usa projeção ANBIMA e dias úteis: o valor aqui é estimativa.
 *
 * Devolve `null` quando falta a série que o indexador precisa.
 */
export function valuePosition(
	position: FixedIncomePosition,
	valuationDate: string,
	series: IndexSeries
): FixedIncomeValuation | null {
	const maturity = position.maturityDate ?? null;
	const valuedAt =
		maturity && maturity < valuationDate ? maturity : valuationDate;
	const days = businessDaysBetween(position.appliedAt, valuedAt);
	const accrual = accrualFactor(position, valuedAt, days, series);
	if (!accrual) return null;

	const grossValue = round2(position.principal * accrual.factor);
	const grossYield = round2(grossValue - position.principal);
	const calendarDays = Math.max(0, daysBetween(position.appliedAt, valuedAt));
	const taxExempt = isTaxExempt(position.kind);
	const incomeTaxRatePct = taxExempt ? 0 : regressiveTaxRatePct(calendarDays);

	let iof = 0;
	let incomeTax = 0;
	// Rendimento negativo (deflação forte no IPCA+) não gera imposto.
	if (grossYield > 0) {
		iof = round2((grossYield * iofRatePct(calendarDays)) / 100);
		incomeTax = round2(((grossYield - iof) * incomeTaxRatePct) / 100);
	}

	return {
		valuedAt,
		grossValue,
		grossYield,
		businessDays: days.length,
		calendarDays,
		iof,
		incomeTax,
		incomeTaxRatePct,
		netValue: round2(grossValue - iof - incomeTax),
		taxExempt,
		estimatedPeriods: accrual.estimatedPeriods,
	};
}

/** Dias úteis de `[from, to)`, em YYYY-MM-DD. */
export function businessDaysBetween(from: string, to: string): string[] {
	const days: string[] = [];
	for (let day = from; day < to; day = addDays(day, 1)) {
		if (isTradingDay(day)) days.push(day);
	}
	return days;
}

type Accrual = { factor: number; estimatedPeriods: number };

function accrualFactor(
	position: FixedIncomePosition,
	valuedAt: string,
	days: string[],
	series: IndexSeries
): Accrual | null {
	const rate = position.ratePct / 100;
	const fixedPart = (annual: number) =>
		(1 + annual) ** (days.length / BUSINESS_DAYS_PER_YEAR);

	switch (position.indexer) {
		case 'PREFIXED':
			return { factor: fixedPart(rate), estimatedPeriods: 0 };
		case 'PERCENT_CDI':
			return cdiAccrual(days, series.cdiDaily, rate);
		case 'CDI_PLUS': {
			const cdi = cdiAccrual(days, series.cdiDaily, 1);
			return cdi && { ...cdi, factor: cdi.factor * fixedPart(rate) };
		}
		case 'IPCA_PLUS': {
			if (days.length === 0) return { factor: 1, estimatedPeriods: 0 };
			const inflation = inflationOverPeriod(
				series.ipcaMonthly ?? [],
				position.appliedAt,
				valuedAt
			);
			if (!inflation) return null;
			return {
				factor: (1 + inflation.inflation) * fixedPart(rate),
				estimatedPeriods: inflation.estimatedMonths,
			};
		}
	}
}

/**
 * `Π (1 + CDIᵈ × percentual)` nos dias úteis. Dia sem CDI publicado (o de
 * hoje sai só à noite) usa o último conhecido e conta como estimado.
 */
function cdiAccrual(
	days: string[],
	cdiDaily: IndexRatePoint[] | undefined,
	share: number
): Accrual | null {
	if (days.length === 0) return { factor: 1, estimatedPeriods: 0 };
	const points = [...(cdiDaily ?? [])].sort((a, b) =>
		a.date.localeCompare(b.date)
	);
	const byDate = new Map(points.map((point) => [point.date, point.value]));

	let lastKnown: number | null = null;
	for (const point of points) {
		if (point.date > days[0]) break;
		lastKnown = point.value;
	}

	let factor = 1;
	let estimatedPeriods = 0;
	for (const day of days) {
		const published = byDate.get(day);
		if (published !== undefined) {
			lastKnown = published;
		} else if (lastKnown === null) {
			return null;
		} else {
			estimatedPeriods++;
		}
		factor *= round8(1 + (lastKnown / 100) * share);
	}
	return { factor, estimatedPeriods };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round8 = (value: number) => Math.round(value * 1e8) / 1e8;
