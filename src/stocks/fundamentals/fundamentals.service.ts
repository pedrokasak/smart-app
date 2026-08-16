import { Injectable, Logger } from '@nestjs/common';
import {
	FundamentusFallbackAdapter,
	FundamentusField,
} from 'src/stocks/adapter/fundamentus-fallback.adapter';
import { YahooFinanceAdapter } from 'src/market-data/infrastructure/yahoo-finance.adapter';
import {
	FundamentalKey,
	FundamentalsResult,
	FundamentalValue,
	FUNDAMENTAL_KEYS,
} from './fundamentals.types';
import { isApplicable } from './sector-applicability';
import { computePayout } from './payout';

const FUNDAMENTUS_LABELS: Partial<Record<FundamentalKey, string>> = {
	roic: 'ROIC',
	netMargin: 'MARG. LIQUIDA',
	netDebt: 'DIV. LIQUIDA',
	priceEarnings: 'P/L',
	priceToBook: 'P/VP',
	returnOnEquity: 'ROE',
};

const BRAPI_FIELDS: Partial<Record<FundamentalKey, string>> = {
	priceEarnings: 'priceEarnings',
};

function unavailable(): FundamentalValue {
	return { status: 'unavailable', value: null, source: null };
}

@Injectable()
export class FundamentalsService {
	private readonly logger = new Logger(FundamentalsService.name);

	constructor(
		private readonly fundamentus: FundamentusFallbackAdapter,
		private readonly yahoo: YahooFinanceAdapter,
	) {}

	async getFundamentals(
		symbol: string,
		brapiQuote: unknown,
	): Promise<FundamentalsResult> {
		const fields = await this.loadFundamentusFields(symbol);
		const sector = fields?.SETOR?.text?.trim() || null;

		const values = {} as Record<FundamentalKey, FundamentalValue>;
		for (const key of FUNDAMENTAL_KEYS) {
			values[key] = isApplicable(sector, key)
				? unavailable()
				: { status: 'not_applicable', value: null, source: null };
		}

		// Chaves que ainda precisam de valor e que ALGUMA fonte sabe ler.
		//
		// Os dois filtros importam. `payout` sai porque tem fonte propria e
		// nunca participa da disputa de grupo. E uma chave que nenhuma fonte
		// mapeia — hoje `evEbitda`, que nem a brapi no plano gratuito nem o
		// Fundamentus publicam — precisa sair tambem: se ficasse, nenhuma
		// fonte conseguiria cobrir o grupo inteiro, o ramo de coerencia nunca
		// dispararia e todo resultado sairia marcado como misto. Ela
		// permanece `unavailable`, que e a resposta correta.
		const readable = (key: FundamentalKey) =>
			BRAPI_FIELDS[key] !== undefined || FUNDAMENTUS_LABELS[key] !== undefined;

		const wanted = FUNDAMENTAL_KEYS.filter(
			(key) =>
				key !== 'payout' &&
				readable(key) &&
				values[key].status === 'unavailable',
		);

		const candidates: Array<{
			source: 'brapi' | 'fundamentus';
			read: (key: FundamentalKey) => number | null;
		}> = [
			{ source: 'brapi', read: (key) => this.readBrapi(brapiQuote, key) },
			{ source: 'fundamentus', read: (key) => this.readFundamentus(fields, key) },
		];

		// 1. Coerencia: a primeira fonte que cobrir TODAS as chaves desejadas
		//    responde sozinha, e o resultado nao e misto.
		const covering = candidates.find((candidate) =>
			wanted.every((key) => candidate.read(key) !== null),
		);

		if (covering && wanted.length > 0) {
			for (const key of wanted) {
				values[key] = {
					status: 'ok',
					value: covering.read(key),
					source: covering.source,
				};
			}
		} else {
			// 2. Degradacao: ninguem cobre o grupo, entao preenche campo a campo
			//    na ordem das fontes. O resultado passa a ser declarado misto.
			for (const key of wanted) {
				for (const candidate of candidates) {
					const value = candidate.read(key);
					if (value !== null) {
						values[key] = { status: 'ok', value, source: candidate.source };
						break;
					}
				}
			}
		}

		await this.fillPayout(values, symbol);
		this.reportSourceDrift('fundamentus', symbol, fields);

		// `payout` nunca disputa o grupo (fonte propria: yahoo/derived) e por
		// isso fica fora daqui. `mixed` descreve a coerencia do grupo lido do
		// balanco (roic, margem, divida, P/L, P/VP, ROE, evEbitda) — nao a
		// origem do payout, que ja e visivel no seu proprio `source`.
		const sources = new Set(
			FUNDAMENTAL_KEYS.filter((key) => key !== 'payout')
				.map((key) => values[key])
				.filter((entry) => entry.status === 'ok')
				.map((entry) => entry.source),
		);

		return { symbol, sector, mixed: sources.size > 1, values };
	}

	private async loadFundamentusFields(
		symbol: string,
	): Promise<Record<string, FundamentusField> | null> {
		try {
			return await this.fundamentus.getFields(symbol);
		} catch (error) {
			this.logger.warn(
				`Fundamentus indisponivel para ${symbol}: ${String(error)}`,
			);
			return null;
		}
	}

	/**
	 * Cascata degrada em silencio: se o Fundamentus mudar de layout, o parser
	 * devolve vazio, a fonte seguinte preenche o que consegue, e o indicador
	 * some do card sem ninguem perceber. Este metodo lembra quais simbolos a
	 * fonte ja respondeu e avisa quando ela para de responder.
	 */
	private static readonly answered = new Map<string, Set<string>>();

	private reportSourceDrift(
		source: string,
		symbol: string,
		fields: Record<string, FundamentusField> | null,
	): void {
		const seen =
			FundamentalsService.answered.get(source) ?? new Set<string>();
		FundamentalsService.answered.set(source, seen);

		const responded = !!fields && Object.keys(fields).length > 0;

		if (responded) {
			seen.add(symbol);
			return;
		}

		if (seen.has(symbol)) {
			seen.delete(symbol);
			this.logger.warn(
				`Fonte ${source} respondia para ${symbol} e parou de responder`,
			);
		}
	}

	private readBrapi(quote: unknown, key: FundamentalKey): number | null {
		const field = BRAPI_FIELDS[key];
		if (!field) return null;
		const raw = ((quote ?? {}) as Record<string, unknown>)[field];
		return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
	}

	private readFundamentus(
		fields: Record<string, FundamentusField> | null,
		key: FundamentalKey,
	): number | null {
		if (!fields) return null;
		const label = FUNDAMENTUS_LABELS[key];
		if (!label) return null;
		return fields[label]?.value ?? null;
	}

	private async fillPayout(
		values: Record<FundamentalKey, FundamentalValue>,
		symbol: string,
	): Promise<void> {
		if (values.payout.status !== 'unavailable') return;

		const inputs = await this.yahoo.getPayoutInputs(symbol);

		if (inputs.payoutRatio !== null && Number.isFinite(inputs.payoutRatio)) {
			values.payout = {
				status: 'ok',
				value: inputs.payoutRatio * 100,
				source: 'yahoo',
			};
			return;
		}

		const derived = computePayout({
			dividendsTotal: inputs.dividendsPaid,
			netIncome: inputs.netIncome,
			dividendsPeriod: inputs.fiscalPeriod,
			netIncomePeriod: inputs.fiscalPeriod,
		});

		if (derived !== null) {
			values.payout = { status: 'ok', value: derived, source: 'derived' };
		}
	}
}
