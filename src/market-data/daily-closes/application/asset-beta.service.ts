import { Inject, Injectable, Logger } from '@nestjs/common';
import { computeAssetBeta } from '../domain/asset-beta';
import { daysAgo } from '../domain/trading-days';
import { DAILY_CLOSES_CONFIG, DailyClosesConfig } from './daily-closes.config';
import {
	ASSET_BETA_WRITER,
	AssetBetaWriter,
	DAILY_CLOSE_STORE,
	DailyCloseStore,
	HELD_SYMBOLS_READER,
	HeldSymbolsReader,
} from './ports';

/** ~252 pregões cabem em um ano de calendário, com folga para feriados. */
const LOOKBACK_DAYS = 400;

/**
 * Beta de cada ativo em carteira contra o BOVA11 (TRA-251).
 *
 * O IBOV em si não está no COTAHIST, e o BOVA11 é o ETF que o replica: serve
 * de mercado para o beta por ativo. Isso NÃO substitui o índice no beta da
 * carteira, que continua usando o IBOV de verdade (e declara quando cai no
 * IFIX); por isso o ativo usado vai gravado junto, em `betaBenchmark`.
 */
@Injectable()
export class AssetBetaService {
	private readonly logger = new Logger(AssetBetaService.name);

	constructor(
		@Inject(DAILY_CLOSE_STORE) private readonly store: DailyCloseStore,
		@Inject(HELD_SYMBOLS_READER) private readonly held: HeldSymbolsReader,
		@Inject(ASSET_BETA_WRITER) private readonly writer: AssetBetaWriter,
		@Inject(DAILY_CLOSES_CONFIG) private readonly config: DailyClosesConfig
	) {}

	/** Devolve quantos ativos foram atualizados. */
	async refresh(now: Date = new Date()): Promise<number> {
		const from = daysAgo(now, LOOKBACK_DAYS);
		const proxy = this.config.marketProxy;
		const market = await this.store.find(proxy, from);
		if (market.length === 0) {
			this.logger.warn(`Sem fechamentos de ${proxy}: beta não atualizado`);
			return 0;
		}

		const symbols = (await this.held.list())
			.map((item) => item.symbol)
			.filter((symbol) => symbol !== proxy);

		const writes = [];
		for (const symbol of symbols) {
			const result = computeAssetBeta(
				await this.store.find(symbol, from),
				market
			);
			writes.push({
				symbol,
				beta: result.beta,
				asOf: result.asOf,
				benchmark: proxy,
			});
		}
		return writes.length ? this.writer.write(writes) : 0;
	}
}
