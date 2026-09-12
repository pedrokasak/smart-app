import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
	MARKET_DATA_PROVIDER,
	type MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import { PortfolioHistory } from 'src/portfolio/schema/portfolio-history.model';
import { TradeDocument } from 'src/fiscal/schema/trade.model';
import { backfillSeries, type PriceLookup } from './backfill-series';

/**
 * Reconstrói o histórico diário da carteira a partir das negociações
 * importadas (TRA-141).
 *
 * ## Por que existe
 *
 * `backfillSeries` foi escrito em TRA-143 e nunca foi chamado: o histórico só
 * nascia do snapshot diário, ou seja, começava no dia em que o usuário entrou
 * no app. Como Sharpe, beta, tracking error e correlação exigem 20 pregões e o
 * VaR de 21 dias exige cerca de 60, todas essas métricas ficavam indisponíveis
 * por semanas — mesmo para quem importou um ano de notas.
 *
 * Com as negociações e os fechamentos históricos reais, a série de um ano sai
 * de uma vez.
 *
 * ## Nunca sobrescreve snapshot existente
 *
 * O snapshot do dia foi calculado com a cotação daquele momento e é a fonte
 * mais próxima da verdade. O backfill usa `$setOnInsert`: preenche só o buraco.
 *
 * ## Sem negociação, não reconstrói
 *
 * Carteira montada na mão não tem como saber a posição passada. `backfillSeries`
 * devolve `covered: false` e nada é gravado — projetar a posição de hoje para
 * trás seria ficção (precedente TRA-55).
 */

/** Teto de símbolos por reconstrução: a fonte de preço é rate-limited. */
const MAX_SYMBOLS = 40;

@Injectable()
export class PortfolioHistoryBackfillService {
	private readonly logger = new Logger(PortfolioHistoryBackfillService.name);

	constructor(
		@InjectModel('Trade')
		private readonly tradeModel: Model<TradeDocument>,
		@InjectModel('PortfolioHistory')
		private readonly historyModel: Model<PortfolioHistory>,
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketData: MarketDataProviderPort
	) {}

	/** Janela pedida ao provedor, pela distância até a primeira negociação. */
	private rangeForSpan(days: number): string {
		if (days <= 370) return '1y';
		if (days <= 740) return '2y';
		if (days <= 1830) return '5y';
		if (days <= 3660) return '10y';
		return 'max';
	}

	async backfill(params: { userId: string; portfolioId: string }): Promise<{
		covered: boolean;
		written: number;
		from: string | null;
		to: string | null;
		missingSymbols: string[];
	}> {
		const empty = {
			covered: false,
			written: 0,
			from: null,
			to: null,
			missingSymbols: [] as string[],
		};

		const trades = await this.tradeModel
			.find({ userId: params.userId, portfolioId: params.portfolioId })
			.sort({ date: 1 })
			.lean()
			.exec();

		if (!trades.length) return empty;

		const symbols = Array.from(
			new Set(trades.map((trade) => String(trade.symbol || '').toUpperCase()))
		).filter(Boolean);
		if (symbols.length > MAX_SYMBOLS) {
			this.logger.warn(
				`Portfólio ${params.portfolioId} tem ${symbols.length} símbolos; reconstruindo só os ${MAX_SYMBOLS} primeiros.`
			);
		}
		const selected = symbols.slice(0, MAX_SYMBOLS);

		const firstTradeTime = new Date(trades[0].date).getTime();
		const spanDays = Math.ceil(
			(Date.now() - firstTradeTime) / (24 * 60 * 60 * 1000)
		);
		const range = this.rangeForSpan(Math.max(0, spanDays));

		const prices: PriceLookup = new Map();
		const missingSymbols: string[] = [];
		const fetched = await Promise.all(
			selected.map(async (symbol) => {
				try {
					return [
						symbol,
						await this.marketData.getDailyCloses(symbol, range),
					] as const;
				} catch (error) {
					this.logger.warn(
						`Fechamentos de ${symbol} indisponíveis: ${(error as Error)?.message || error}`
					);
					return [symbol, []] as const;
				}
			})
		);
		for (const [symbol, closes] of fetched) {
			if (!closes.length) {
				// Sem cotação o ativo entra pelo custo e o ponto sai marcado como
				// `stale` — declarado, não escondido.
				missingSymbols.push(symbol);
				continue;
			}
			prices.set(
				symbol,
				new Map(
					closes.map((point) => [point.date, point.close] as [string, number])
				)
			);
		}

		const result = backfillSeries({
			trades: trades.map((trade) => ({
				symbol: String(trade.symbol || '').toUpperCase(),
				side: trade.side,
				quantity: trade.quantity,
				price: trade.price,
				date: trade.date,
			})),
			prices,
		});

		if (!result.covered || !result.points.length) {
			return { ...empty, missingSymbols };
		}

		const operations = result.points.map((point) => ({
			updateOne: {
				filter: { portfolioId: params.portfolioId, date: point.date },
				update: {
					$setOnInsert: {
						userId: params.userId,
						portfolioId: params.portfolioId,
						date: point.date,
						totalValue: point.totalValue,
						investedValue: point.investedValue,
						stale: point.stale,
						staleSymbols: point.staleSymbols,
						tradingDay: point.tradingDay,
						nonTradingReason: point.nonTradingReason,
					},
				},
				upsert: true,
			},
		}));

		const bulk = await this.historyModel.bulkWrite(operations as any, {
			ordered: false,
		});
		const written = Number(bulk?.upsertedCount) || 0;

		this.logger.log(
			`Histórico reconstruído para o portfólio ${params.portfolioId}: ${written} dia(s) gravado(s) de ${result.points.length} reconstruído(s).`
		);

		return {
			covered: true,
			written,
			from: result.points[0].date,
			to: result.points[result.points.length - 1].date,
			missingSymbols,
		};
	}
}
