import {
	BadRequestException,
	Inject,
	Injectable,
	Optional,
} from '@nestjs/common';
import { todayInSaoPaulo } from 'src/macro-indicators/application/macro-series.service';
import { buildAnalysis } from '../domain/comparison-analysis';
import { addDays, toBrDate, toBrMonth } from '../domain/dates';
import { regressiveTaxRatePct } from '../domain/fixed-income-tax';
import type { Indexer, Instrument } from '../domain/instrument';
import { offerRateError, offerToInstrument } from '../domain/offer';
import {
	type Scenario,
	daysFromYears,
	simulateInstrument,
} from '../domain/simulation';
import {
	pickTitlesForHorizon,
	resolveTitlesById,
} from '../domain/tesouro-selection';
import type { TesouroFamily, TesouroTitle } from '../domain/tesouro-title';
import {
	type AssumptionValue,
	type ComparisonRequest,
	type ComparisonResult,
	MarketRateUnavailableError,
} from './comparison.types';
import { FIXED_INCOME_CLOCK } from './fixed-income-clock';
import {
	FixedIncomeRatesService,
	type MarketRate,
} from './fixed-income-rates.service';

const TESOURO_INDEXER: Record<TesouroFamily, Indexer> = {
	SELIC: 'CDI_PLUS',
	PREFIXED: 'PREFIXED',
	IPCA_PLUS: 'IPCA_PLUS',
};

const CDI_REFERENCE: Instrument = {
	id: 'reference-cdi',
	name: '100% do CDI',
	kind: 'REFERENCIA',
	family: 'REFERENCE',
	indexer: 'PERCENT_CDI',
	ratePct: 100,
};

const titleToInstrument = (title: TesouroTitle): Instrument => ({
	id: title.id,
	name: title.name,
	kind: 'TESOURO',
	family: 'TESOURO',
	indexer: TESOURO_INDEXER[title.family],
	ratePct: title.buyRatePct,
	maturityDate: title.maturityDate,
});

function resolveAssumption(
	field: 'cdi' | 'ipca',
	typed: number | undefined,
	market: MarketRate | null,
	warnings: string[]
): AssumptionValue {
	if (typed !== undefined) return { valuePct: typed, source: 'user' };
	if (!market) throw new MarketRateUnavailableError(field);
	if (market.stale) {
		// O IPCA é mensal: a data de referência é o mês, não o dia 01.
		const [label, when] =
			field === 'cdi'
				? ['O CDI', toBrDate(market.asOf)]
				: ['O IPCA', toBrMonth(market.asOf)];
		warnings.push(
			`${label} de mercado é de ${when} e pode estar desatualizado.`
		);
	}
	return { valuePct: market.valuePct, source: 'market', asOf: market.asOf };
}

/**
 * Comparação de renda fixa lado a lado (TRA-269). Todo número de mercado vem
 * de fonte oficial (BACEN, Tesouro Transparente) ou de quem simula; o que não
 * tem fonte falha ou fica de fora, nunca é preenchido com valor suposto.
 */
@Injectable()
export class FixedIncomeComparisonService {
	constructor(
		private readonly ratesService: FixedIncomeRatesService,
		@Optional()
		@Inject(FIXED_INCOME_CLOCK)
		private readonly clock?: () => Date
	) {}

	async compare(request: ComparisonRequest): Promise<ComparisonResult> {
		const offers = request.offers ?? [];
		for (const offer of offers) {
			const error = offerRateError(offer);
			if (error) throw new BadRequestException(error);
		}

		const market = await this.ratesService.getRates();
		const warnings: string[] = [];
		const cdi = resolveAssumption('cdi', request.cdiPct, market.cdi, warnings);
		const ipca = resolveAssumption(
			'ipca',
			request.ipcaPct,
			market.ipca12m,
			warnings
		);

		const today = todayInSaoPaulo(this.clock ? this.clock() : new Date());
		const days = daysFromYears(request.years);
		const scenario: Scenario = {
			principal: request.principal,
			years: request.years,
			days,
			cdiPct: cdi.valuePct,
			ipcaPct: ipca.valuePct,
			horizonEnd: addDays(today, days),
		};

		const tesouroInstruments = this.tesouroInstruments(
			market.tesouro,
			request.tesouroIds,
			scenario.horizonEnd,
			warnings
		);
		const instruments: Instrument[] = [
			...tesouroInstruments,
			...offers.map((offer, index) => offerToInstrument(offer, index)),
			CDI_REFERENCE,
		];

		const simulated = instruments.map((instrument) =>
			simulateInstrument(instrument, scenario)
		);
		const best = simulated.reduce((top, row) =>
			row.realAnnualPct > top.realAnnualPct ? row : top
		);

		return {
			scenario: {
				principal: scenario.principal,
				years: scenario.years,
				days,
				horizonEnd: scenario.horizonEnd,
				irRatePct: regressiveTaxRatePct(days),
				cdi,
				ipca,
			},
			rows: simulated.map((row) => ({ ...row, isBest: row.id === best.id })),
			analysis: buildAnalysis(simulated, scenario),
			warnings,
			selicMeta: market.selicMeta,
			tesouro: market.tesouro && {
				baseDate: market.tesouro.baseDate,
				fetchedAt: market.tesouro.fetchedAt,
				stale: market.tesouro.stale,
				sourceUrl: market.tesouro.sourceUrl,
			},
		};
	}

	private tesouroInstruments(
		tesouro: Awaited<
			ReturnType<FixedIncomeRatesService['getRates']>
		>['tesouro'],
		tesouroIds: string[] | undefined,
		horizonEnd: string,
		warnings: string[]
	): Instrument[] {
		if (!tesouro) {
			warnings.push(
				'Taxas do Tesouro Direto indisponíveis agora: a comparação segue sem os títulos.'
			);
			return [];
		}
		if (tesouro.stale) {
			warnings.push(
				`As taxas do Tesouro Direto são do pregão de ${toBrDate(tesouro.baseDate)}, de mais de uma semana atrás.`
			);
		}
		const selection = tesouroIds?.length
			? resolveTitlesById(tesouro.titles, tesouroIds)
			: pickTitlesForHorizon(tesouro.titles, horizonEnd);
		warnings.push(...selection.warnings);
		return selection.titles.map(titleToInstrument);
	}
}
