import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
	MARKET_DATA_PROVIDER,
	type MarketAssetType,
	type MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import { PortfolioService } from 'src/portfolio/portfolio.service';
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
 * mais próxima da verdade. O backfill usa `$setOnInsert`: preenche o buraco.
 *
 * A única linha que ele troca é a que ele mesmo gravou a custo, por não ter
 * achado fechamento naquela rodada (TRA-279). Ela é reconhecida sem ambiguidade
 * (ver `ownCostOnlyPoint`), e a troca é entre duas reconstruções do mesmo
 * conjunto de ativos — o snapshot, que valoriza a carteira inteira, nunca casa.
 *
 * ## Sem negociação, não reconstrói
 *
 * Carteira montada na mão não tem como saber a posição passada. `backfillSeries`
 * devolve `covered: false` e nada é gravado — projetar a posição de hoje para
 * trás seria ficção (precedente TRA-55).
 */

/**
 * Filtro da linha que esta reconstrução pode trocar (TRA-279): gravada por uma
 * reconstrução anterior e toda a custo.
 *
 * - `createdAt` mais de dois dias depois de `date`: o snapshot diário grava o
 *   próprio dia; só a reconstrução escreve no passado;
 * - `stale` e valor igual ao custo: nenhuma cotação naquele ponto;
 * - mais símbolos sem cotação do que o ponto novo: só troca se melhorar.
 */
export function ownCostOnlyPoint(date: string, newStaleCount: number) {
	const writtenAfter = new Date(`${date}T00:00:00.000Z`);
	writtenAfter.setUTCDate(writtenAfter.getUTCDate() + 2);
	return {
		stale: true,
		investedValue: { $exists: true, $ne: null },
		createdAt: { $gt: writtenAfter },
		$expr: {
			$and: [
				{
					$lte: [
						{ $abs: { $subtract: ['$totalValue', '$investedValue'] } },
						0.01,
					],
				},
				{
					$gt: [{ $size: { $ifNull: ['$staleSymbols', []] } }, newStaleCount],
				},
			],
		},
	};
}

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
		private readonly marketData: MarketDataProviderPort,
		private readonly portfolioService: PortfolioService
	) {}

	/**
	 * Tipo de cada símbolo, lido dos ativos do portfólio. A negociação só guarda
	 * o símbolo; sem o tipo, cripto seria buscada como ação e a série viria
	 * errada (TRA-141). Símbolo desconhecido cai em ação, o padrão anterior.
	 */
	private async assetTypesBySymbol(
		portfolioId: string
	): Promise<Map<string, MarketAssetType>> {
		const types = new Map<string, MarketAssetType>();
		try {
			const portfolio: any =
				await this.portfolioService.getPortfolioWithAssets(portfolioId);
			for (const asset of portfolio?.assets ?? []) {
				const symbol = String(asset?.symbol || '').toUpperCase();
				if (symbol && asset?.type) {
					types.set(symbol, asset.type as MarketAssetType);
				}
			}
		} catch (error) {
			this.logger.warn(
				`Tipos dos ativos indisponíveis para ${portfolioId}: ${(error as Error)?.message || error}`
			);
		}
		return types;
	}

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
		/** Linhas a custo da reconstrução anterior trocadas por mercado. */
		replaced: number;
		from: string | null;
		to: string | null;
		missingSymbols: string[];
	}> {
		const empty = {
			covered: false,
			written: 0,
			replaced: 0,
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

		const assetTypes = await this.assetTypesBySymbol(params.portfolioId);
		const prices: PriceLookup = new Map();
		const missingSymbols: string[] = [];
		const fetched = await Promise.all(
			selected.map(async (symbol) => {
				try {
					return [
						symbol,
						await this.marketData.getDailyCloses(
							symbol,
							range,
							assetTypes.get(symbol) ?? 'stock'
						),
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

		const operations = result.points.flatMap((point) => {
			const fields = {
				totalValue: point.totalValue,
				investedValue: point.investedValue,
				stale: point.stale,
				staleSymbols: point.staleSymbols,
				tradingDay: point.tradingDay,
			};
			return [
				{
					updateOne: {
						filter: { portfolioId: params.portfolioId, date: point.date },
						update: {
							$setOnInsert: {
								userId: params.userId,
								portfolioId: params.portfolioId,
								date: point.date,
								...fields,
								nonTradingReason: point.nonTradingReason,
							},
						},
						upsert: true,
					},
				},
				{
					// Sem upsert: só casa a linha a custo da reconstrução anterior.
					updateOne: {
						filter: {
							portfolioId: params.portfolioId,
							date: point.date,
							...ownCostOnlyPoint(point.date, point.staleSymbols.length),
						},
						update: { $set: fields },
					},
				},
			];
		});

		const bulk = await this.historyModel.bulkWrite(operations as any, {
			ordered: false,
		});
		const written = Number(bulk?.upsertedCount) || 0;
		const replaced = Number(bulk?.modifiedCount) || 0;

		this.logger.log(
			`Histórico reconstruído para o portfólio ${params.portfolioId}: ${written} dia(s) novo(s), ${replaced} dia(s) a custo trocado(s) por fechamento, de ${result.points.length} reconstruído(s).`
		);

		return {
			covered: true,
			written,
			replaced,
			from: result.points[0].date,
			to: result.points[result.points.length - 1].date,
			missingSymbols,
		};
	}
}
