import { Inject, Injectable, Logger } from '@nestjs/common';
import {
	RI_DOCUMENT_CONTENT,
	RiDocumentContentPort,
} from 'src/ri-intelligence/application/ri-document-content.port';
import { RiDocumentDiscoveryPort } from 'src/ri-intelligence/application/ri-document-discovery.port';
import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import {
	isPermanentContentFailure,
	isWatchRelevant,
	RiWatchDocument,
} from 'src/ri-intelligence/watch/domain/ri-watch';
import {
	HELD_TICKER_DIRECTORY,
	HeldTickerDirectory,
} from './ports/held-ticker-directory.port';
import { RI_WATCH_DISCOVERY } from './ports/ri-watch-discovery.port';
import { RI_WATCH_STORE, RiWatchStore } from './ports/ri-watch-store.port';
import { RI_WATCH_CONFIG, RiWatchConfig } from './ri-watch.config';

const DAY_MS = 24 * 60 * 60 * 1000;

type ProcessOutcome = 'summarized' | 'skipped' | 'failed';

export interface RiWatchScanResult {
	tickers: number;
	registered: number;
	failedTickers: number;
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
 * verificacao de fidelidade e as citacoes (TRA-239), e cai no mesmo cache.
 * Por isso a rotina ja entrega valor antes de notificar alguem: quem abrir o
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
		@Inject(RI_DOCUMENT_CONTENT)
		private readonly content: RiDocumentContentPort,
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

		return { tickers: tickers.length, registered, failedTickers };
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
		const fetched = await this.content.fetchTextContent(
			doc.record.source.value
		);
		if (!fetched.text) {
			const reason = `content_${fetched.reason ?? 'unavailable'}`;
			if (isPermanentContentFailure(fetched.reason)) {
				await this.store.markSkipped(doc.key, reason, now);
				return 'skipped';
			}
			await this.store.recordFailure(doc.key, reason, now);
			return 'failed';
		}

		const output = await this.summaries.summarize({
			document: { ...doc.record, contentStatus: 'extracted' },
			content: fetched.text,
			// Rotina do sistema: o custo e por documento, nao por usuario, e o
			// acesso ao resumo continua travado por plano na hora da leitura.
			allowAi: true,
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
