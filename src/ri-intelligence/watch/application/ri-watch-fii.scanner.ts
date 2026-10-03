import { Inject, Injectable, Logger } from '@nestjs/common';
import { fiiFilingToRecord } from 'src/ri-intelligence/watch/domain/fii-filing';
import { isWatchRelevant } from 'src/ri-intelligence/watch/domain/ri-watch';
import {
	FII_FILING_FEED,
	FiiFilingFeedPort,
} from './ports/fii-filing-feed.port';
import {
	FII_FUND_DIRECTORY,
	FiiFundDirectory,
} from './ports/fii-fund-directory.port';
import {
	HELD_TICKER_DIRECTORY,
	HeldTickerDirectory,
} from './ports/held-ticker-directory.port';
import { RI_WATCH_STORE, RiWatchStore } from './ports/ri-watch-store.port';
import { RI_WATCH_CONFIG, RiWatchConfig } from './ri-watch.config';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Falhas seguidas da FundosNet que encerram a varredura de FII da rodada. */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Varredura de FII nesta rodada. `skipped`: ligada, mas sem FII em
 * carteira; `failed`: o cadastro de fundos da CVM nao carregou, ou a
 * FundosNet falhou seguidas vezes e a varredura parou no meio.
 */
export type RiWatchFiiScanStatus = 'ok' | 'failed' | 'disabled' | 'skipped';

export interface RiWatchFiiScanResult {
	status: RiWatchFiiScanStatus;
	/** FIIs em carteira. */
	tickers: number;
	/** FIIs sem CNPJ conhecido no cadastro da CVM. */
	unresolved: number;
	/** Fundos cuja consulta na FundosNet falhou nesta rodada. */
	failedFunds: number;
	registered: number;
}

/**
 * Vigia de RI para FII (TRA-266): registra os documentos novos dos FIIs em
 * carteira, pela FundosNet da B3. Daqui em diante o documento segue o mesmo
 * caminho dos de companhia — resumo, aviso a quem tem o FII (TRA-261) e
 * acervo do chat (TRA-264) — porque a fila e a mesma.
 *
 * Classe propria, e nao mais um passo dentro de `RiWatchService.scan`: a
 * fonte, o cadastro e a falha sao outros, e a varredura das acoes, que ja
 * funciona, nao muda.
 *
 * Sem janela diaria: a FundosNet e consultada por fundo, entao a janela e a
 * mesma da descoberta (`lookbackDays`) e uma rodada perdida nao abre buraco.
 * O registro e idempotente; a idade maxima do aviso (`notifyMaxAgeDays`)
 * segura a primeira rodada.
 *
 * Um fundo problematico nao derruba os outros, e o cadastro fora do ar so
 * tira os FIIs da rodada. Falha do banco sobe para o agendador, como na
 * varredura das acoes.
 */
@Injectable()
export class RiWatchFiiScanner {
	private readonly logger = new Logger(RiWatchFiiScanner.name);

	constructor(
		@Inject(RI_WATCH_STORE) private readonly store: RiWatchStore,
		@Inject(HELD_TICKER_DIRECTORY)
		private readonly directory: HeldTickerDirectory,
		@Inject(FII_FUND_DIRECTORY) private readonly funds: FiiFundDirectory,
		@Inject(FII_FILING_FEED) private readonly feed: FiiFilingFeedPort,
		@Inject(RI_WATCH_CONFIG) private readonly config: RiWatchConfig
	) {}

	async scan(now: Date = new Date()): Promise<RiWatchFiiScanResult> {
		const result: RiWatchFiiScanResult = {
			status: 'disabled',
			tickers: 0,
			unresolved: 0,
			failedFunds: 0,
			registered: 0,
		};
		if (!this.config.fiiEnabled) return result;

		const tickers = await this.directory.heldFiiTickers();
		result.tickers = tickers.length;
		if (!tickers.length) return { ...result, status: 'skipped' };

		let tickerByCnpj: Map<string, string>;
		try {
			tickerByCnpj = await this.tickersByFund(tickers, result);
		} catch (err) {
			this.logger.warn(
				`Vigia de RI: cadastro de FII da CVM indisponivel (${this.messageOf(err)}); FIIs fora desta rodada`
			);
			return { ...result, status: 'failed' };
		}

		const from = new Date(now.getTime() - this.config.lookbackDays * DAY_MS);
		let consecutiveFailures = 0;
		// Sequencial: um sistema publico da B3, uma consulta por vez.
		for (const [cnpj, ticker] of tickerByCnpj) {
			// FundosNet travada (cada consulta espera ate 30s): sem este corte,
			// centenas de fundos segurariam a rodada por horas, e o resumo e o
			// aviso das acoes esperariam junto. O resto fica para a proxima.
			if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
				this.logger.warn(
					`Vigia de RI: FundosNet falhou ${consecutiveFailures} vezes seguidas; FIIs restantes ficam para a proxima rodada`
				);
				return { ...result, status: 'failed' };
			}
			try {
				const records = (await this.feed.listFundFilings(cnpj, from, now))
					.filter((filing) => filing.active && !filing.structured)
					.map((filing) => fiiFilingToRecord(filing, ticker))
					.filter(isWatchRelevant);
				consecutiveFailures = 0;
				if (records.length) {
					result.registered += await this.store.registerNew(records, now);
				}
			} catch (err) {
				consecutiveFailures += 1;
				result.failedFunds += 1;
				this.logger.warn(
					`Vigia de RI: FundosNet falhou para ${ticker}: ${this.messageOf(err)}`
				);
			}
		}

		if (result.unresolved) {
			this.logger.warn(
				`Vigia de RI: ${result.unresolved} FII(s) sem CNPJ no cadastro da CVM`
			);
		}
		return { ...result, status: 'ok' };
	}

	/**
	 * CNPJ -> ticker. Tickers em ordem: com cota e recibo do mesmo fundo
	 * (HGLG11/HGLG13), o fundo e consultado uma vez e o documento fica sob o
	 * mesmo ticker, de forma deterministica.
	 */
	private async tickersByFund(
		tickers: string[],
		result: RiWatchFiiScanResult
	): Promise<Map<string, string>> {
		const byCnpj = new Map<string, string>();
		for (const ticker of [...tickers].sort()) {
			const cnpj = await this.funds.resolveFundCnpj(ticker);
			if (!cnpj) {
				result.unresolved += 1;
				continue;
			}
			if (!byCnpj.has(cnpj)) byCnpj.set(cnpj, ticker);
		}
		return byCnpj;
	}

	private messageOf(err: unknown): string {
		return err instanceof Error ? err.message : String(err);
	}
}
