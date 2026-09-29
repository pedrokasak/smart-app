import { Inject, Injectable, Logger } from '@nestjs/common';
import { RiDocumentContentResolver } from 'src/ri-intelligence/application/ri-document-content.resolver';
import { RiDocumentDiscoveryPort } from 'src/ri-intelligence/application/ri-document-discovery.port';
import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import { deliveryToRecord } from 'src/ri-intelligence/watch/domain/ri-delivery';
import {
	isPermanentContentFailure,
	isWatchRelevant,
	RiWatchDocument,
} from 'src/ri-intelligence/watch/domain/ri-watch';
import {
	HELD_TICKER_DIRECTORY,
	HeldTickerDirectory,
} from './ports/held-ticker-directory.port';
import {
	ISSUER_CODE_DIRECTORY,
	IssuerCodeDirectory,
} from './ports/issuer-code-directory.port';
import {
	RI_DELIVERY_FEED,
	RiDeliveryFeedPort,
} from './ports/ri-delivery-feed.port';
import { RI_WATCH_DISCOVERY } from './ports/ri-watch-discovery.port';
import { RI_WATCH_STORE, RiWatchStore } from './ports/ri-watch-store.port';
import { RI_WATCH_CONFIG, RiWatchConfig } from './ri-watch.config';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Janela da consulta diaria do ENET. Dois dias: a rodada das 7h ainda pega o
 * que foi entregue na noite anterior, depois da rodada das 18h, e uma rodada
 * perdida (deploy, queda) nao abre buraco. O que escapar mesmo assim, o IPE
 * semanal reconcilia.
 */
const DAILY_FEED_WINDOW_DAYS = 2;

type ProcessOutcome = 'summarized' | 'skipped' | 'failed';

/**
 * Consulta diaria do ENET nesta rodada (TRA-260). `skipped`: ligada, mas sem
 * o que perguntar (nenhum ticker em carteira com codigo CVM conhecido).
 */
export type RiWatchDailyFeedStatus = 'ok' | 'failed' | 'disabled' | 'skipped';

export interface RiWatchScanResult {
	tickers: number;
	registered: number;
	failedTickers: number;
	dailyFeed: RiWatchDailyFeedStatus;
}

export type RiWatchProcessResult = Record<ProcessOutcome, number>;

/**
 * Vigia de RI (TRA-240), etapa 1: descobrir e pre-resumir.
 *
 * Duas fases separadas de proposito:
 *
 * - `scan` so REGISTRA documentos novos. E barata (o dataset da CVM fica em
 *   cache no adapter) e idempotente: rodar de novo nao duplica nada.
 * - `processPending` gasta IA, com teto por execucao. Um documento com falha
 *   transitoria volta na proxima rodada; com falha permanente sai da fila.
 *
 * O resumo sai do mesmo `RiDocumentSummaryService` do RI Inteligente, com a
 * verificacao de fidelidade e as citacoes (TRA-239), e cai no mesmo cache —
 * inclusive pela chave do protocolo da CVM (TRA-260), que acha o resumo
 * quando a tela lista o documento pelo IPE e o vigia o viu pelo ENET. Por
 * isso a rotina ja entrega valor antes de notificar alguem: quem abrir o
 * documento na tela encontra o resumo pronto, sem esperar a IA.
 *
 * Nunca lanca: roda em cron, e um ticker ou documento problematico nao pode
 * derrubar a varredura dos outros.
 */
@Injectable()
export class RiWatchService {
	private readonly logger = new Logger(RiWatchService.name);

	constructor(
		@Inject(RI_WATCH_STORE) private readonly store: RiWatchStore,
		@Inject(HELD_TICKER_DIRECTORY)
		private readonly directory: HeldTickerDirectory,
		@Inject(RI_WATCH_DISCOVERY)
		private readonly discovery: RiDocumentDiscoveryPort,
		@Inject(RI_DELIVERY_FEED)
		private readonly dailyFeed: RiDeliveryFeedPort,
		@Inject(ISSUER_CODE_DIRECTORY)
		private readonly issuerCodes: IssuerCodeDirectory,
		// O mesmo resolver da tela e do chat (TRA-253): o texto que o vigia le
		// fica em cache, e o chat acha o documento pronto.
		private readonly contentResolver: RiDocumentContentResolver,
		private readonly summaries: RiDocumentSummaryService,
		@Inject(RI_WATCH_CONFIG) private readonly config: RiWatchConfig
	) {}

	async scan(now: Date = new Date()): Promise<RiWatchScanResult> {
		const tickers = await this.directory.heldStockTickers();
		const dateFrom = new Date(
			now.getTime() - this.config.lookbackDays * DAY_MS
		);

		let registered = 0;
		let failedTickers = 0;
		let dailyFeed: RiWatchDailyFeedStatus = 'disabled';

		// Primeiro a fonte diaria (TRA-260): e ela que ve o documento no dia
		// da entrega. Falhou (fora do ar, formato mudou, captcha ligado)? A
		// rodada segue com o IPE semanal logo abaixo — nada se perde, so
		// chega mais tarde.
		if (this.config.dailyFeedEnabled) {
			try {
				const feed = await this.scanDailyFeed(tickers, now);
				registered += feed.registered;
				dailyFeed = feed.status;
			} catch (err) {
				dailyFeed = 'failed';
				this.logger.warn(
					`Vigia de RI: consulta diaria do ENET indisponivel (${this.messageOf(err)}); seguindo so com o IPE semanal`
				);
			}
		}

		// Sequencial: o adapter da CVM compartilha um unico download do
		// dataset anual; em paralelo, N tickers disparariam N downloads.
		for (const ticker of tickers) {
			try {
				const records = await this.discovery.discover({
					ticker,
					company: '',
					origin: null,
					dateFrom,
					dateTo: now,
				});
				const relevant = records.filter(isWatchRelevant);
				if (relevant.length) {
					registered += await this.store.registerNew(relevant, now);
				}
			} catch (err) {
				failedTickers += 1;
				this.logger.warn(
					`Vigia de RI: descoberta falhou para ${ticker}: ${this.messageOf(err)}`
				);
			}
		}

		return { tickers: tickers.length, registered, failedTickers, dailyFeed };
	}

	/**
	 * Uma consulta com todas as companhias do periodo, filtrada pelas que
	 * estao em carteira. Mesmo `registerNew` do IPE: a chave e o protocolo
	 * de entrega, entao o documento que chegar de novo pelo IPE nao duplica.
	 */
	private async scanDailyFeed(
		tickers: string[],
		now: Date
	): Promise<{ status: 'ok' | 'skipped'; registered: number }> {
		if (!tickers.length) return { status: 'skipped', registered: 0 };

		const tickerByCvmCode = await this.tickersByCvmCode(tickers);
		if (!tickerByCvmCode.size) {
			// Ha acoes em carteira e nenhuma tem codigo CVM: o registro da B3
			// mudou ou veio incompleto. Sem este aviso, a fonte diaria ficaria
			// muda sem ninguem notar.
			this.logger.warn(
				`Vigia de RI: nenhum codigo CVM para ${tickers.length} ticker(s); consulta diaria do ENET nao feita`
			);
			return { status: 'skipped', registered: 0 };
		}

		const deliveries = await this.dailyFeed.listDeliveries(
			new Date(now.getTime() - DAILY_FEED_WINDOW_DAYS * DAY_MS),
			now
		);
		const relevant = deliveries
			.flatMap((delivery) => {
				const ticker = tickerByCvmCode.get(delivery.cvmCode);
				return ticker ? [deliveryToRecord(delivery, ticker)] : [];
			})
			.filter(isWatchRelevant);

		return {
			status: 'ok',
			registered: relevant.length
				? await this.store.registerNew(relevant, now)
				: 0,
		};
	}

	/**
	 * Codigo CVM -> ticker. Tickers em ordem: com duas classes (PETR3/PETR4,
	 * mesmo codigo CVM), o documento fica sempre sob a mesma, de forma
	 * deterministica.
	 */
	private async tickersByCvmCode(
		tickers: string[]
	): Promise<Map<string, string>> {
		const byCode = new Map<string, string>();
		for (const ticker of [...tickers].sort()) {
			const code = await this.issuerCodes.resolveCvmCode(ticker);
			if (code && !byCode.has(code)) byCode.set(code, ticker);
		}
		return byCode;
	}

	async processPending(now: Date = new Date()): Promise<RiWatchProcessResult> {
		const result: RiWatchProcessResult = {
			summarized: 0,
			skipped: 0,
			failed: 0,
		};
		if (this.config.maxSummariesPerRun <= 0) return result;

		const pending = await this.store.findPending(
			this.config.maxSummariesPerRun
		);
		// Sequencial: e a rotina que paga a IA; um documento por vez mantem
		// o custo e a carga previsiveis, e o teto por execucao limita o total.
		for (const doc of pending) {
			try {
				result[await this.processOne(doc, now)] += 1;
			} catch (err) {
				result.failed += 1;
				this.logger.warn(
					`Vigia de RI: falha inesperada em ${doc.key}: ${this.messageOf(err)}`
				);
				await this.store
					.recordFailure(doc.key, 'unexpected_error', now)
					.catch(() => undefined);
			}
		}

		return result;
	}

	private async processOne(
		doc: RiWatchDocument,
		now: Date
	): Promise<ProcessOutcome> {
		// Sem checar se o papel ainda esta em carteira, de proposito: o mesmo
		// documento vale para todas as classes da empresa (PETR3 e PETR4 tem o
		// mesmo CNPJ) e e registrado uma vez so, sob o primeiro ticker achado.
		// Checar aquele ticker pularia o documento de quem tem a outra classe.
		const resolved = await this.contentResolver.resolve(doc.record);
		if (!resolved.content) {
			const reason = `content_${resolved.reason ?? 'unavailable'}`;
			if (isPermanentContentFailure(resolved.reason ?? undefined)) {
				await this.store.markSkipped(doc.key, reason, now);
				return 'skipped';
			}
			await this.store.recordFailure(doc.key, reason, now);
			return 'failed';
		}

		const output = await this.summaries.summarize({
			document: resolved.document,
			content: resolved.content,
			// Rotina do sistema: o custo e por documento, nao por usuario, e o
			// acesso ao resumo continua travado por plano na hora da leitura.
			allowAi: true,
			// Registro da propria descoberta: o resumo vale tambem para as
			// outras listagens do mesmo documento da CVM (TRA-260).
			serverDiscovered: true,
		});

		if (output.summary.sourceLabel === 'ai_summary') {
			await this.store.markSummarized(
				doc.key,
				{
					highlights: output.summary.highlights,
					citations: output.summary.citations ?? [],
				},
				now
			);
			return 'summarized';
		}

		if (output.summary.status === 'insufficient_content') {
			await this.store.markSkipped(doc.key, 'insufficient_content', now);
			return 'skipped';
		}

		await this.store.recordFailure(
			doc.key,
			output.summary.limitations[0] ?? 'ai_failed',
			now
		);
		return 'failed';
	}

	private messageOf(err: unknown): string {
		return err instanceof Error ? err.message : String(err);
	}
}
