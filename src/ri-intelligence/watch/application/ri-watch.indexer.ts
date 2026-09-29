import { Inject, Injectable, Logger } from '@nestjs/common';
import { RiDocumentContentResolver } from 'src/ri-intelligence/application/ri-document-content.resolver';
import {
	RI_KNOWLEDGE,
	RiKnowledgePort,
} from 'src/ri-intelligence/application/ri-knowledge.port';
import { issuerBaseCode } from 'src/ri-intelligence/domain/issuer-base-code';
import {
	isPermanentContentFailure,
	RiWatchDocument,
} from 'src/ri-intelligence/watch/domain/ri-watch';
import { RI_WATCH_STORE, RiWatchStore } from './ports/ri-watch-store.port';
import { RI_WATCH_CONFIG, RiWatchConfig } from './ri-watch.config';

/**
 * Documentos indexados por rodada. Um DFP embeda centenas de chunks e leva
 * minutos; o teto segura a rodada, e o resto entra nas seguintes.
 */
const INDEX_BATCH = 20;

export interface RiWatchIndexResult {
	/** Documentos que sairam da fila do acervo nesta rodada. */
	documents: number;
	/** Deles, os que entraram no acervo (os outros nao tinham texto). */
	indexed: number;
	/** Documentos que falharam e ficam para a proxima rodada. */
	failed: number;
}

/**
 * Vigia de RI, etapa D (TRA-264): o texto dos documentos processados vai
 * para o acervo de RI do trackerr-ia, onde o chat pergunta e cita documento
 * e pagina.
 *
 * Etapa propria, e nao parte do processamento, de proposito:
 * - roda DEPOIS do aviso a quem tem o papel (TRA-261): embedar um DFP leva
 *   minutos, e o aviso nao pode esperar por isso;
 * - a fila e o proprio estado do documento (`indexedAt`): o que o vigia
 *   processou antes de o acervo existir entra na fila e o preenche aos
 *   poucos, sem rotina de carga separada.
 *
 * O texto vem do mesmo resolver do processamento (TRA-253), quase sempre do
 * cache de texto — nao se baixa o PDF de novo. Reindexar o mesmo texto nao
 * custa nada: o trackerr-ia compara a hash.
 *
 * Nunca lanca: roda em cron. O que falha fica na fila para a proxima rodada.
 */
@Injectable()
export class RiWatchIndexer {
	private readonly logger = new Logger(RiWatchIndexer.name);

	constructor(
		@Inject(RI_WATCH_STORE) private readonly store: RiWatchStore,
		private readonly contentResolver: RiDocumentContentResolver,
		@Inject(RI_KNOWLEDGE) private readonly knowledge: RiKnowledgePort,
		@Inject(RI_WATCH_CONFIG) private readonly config: RiWatchConfig
	) {}

	async indexProcessed(now: Date = new Date()): Promise<RiWatchIndexResult> {
		const result: RiWatchIndexResult = { documents: 0, indexed: 0, failed: 0 };
		if (!this.config.indexEnabled) return result;

		const docs = await this.store.findUnindexed(INDEX_BATCH);
		for (const doc of docs) {
			try {
				const indexed = await this.indexOne(doc, now);
				result.documents += 1;
				if (indexed) result.indexed += 1;
			} catch (err) {
				result.failed += 1;
				this.logger.warn(
					`Vigia de RI: indexar ${doc.key} no acervo falhou: ${this.messageOf(err)}`
				);
			}
		}
		return result;
	}

	/** `true` quando o texto entrou no acervo; `false` quando nao havia. */
	private async indexOne(doc: RiWatchDocument, now: Date): Promise<boolean> {
		const issuer = issuerBaseCode(doc.ticker);
		if (!issuer) {
			// Sem codigo de emissor, a pergunta do chat nunca chegaria nele.
			await this.store.markIndexed(doc.key, now);
			return false;
		}

		const resolved = await this.contentResolver.resolve(doc.record);
		if (!resolved.content) {
			// PDF escaneado, arquivo que nao e PDF: nunca vai ter texto. Falha
			// passageira (rede): fica na fila.
			if (isPermanentContentFailure(resolved.reason ?? undefined)) {
				await this.store.markIndexed(doc.key, now);
				return false;
			}
			throw new Error(`content_${resolved.reason ?? 'unavailable'}`);
		}

		await this.knowledge.index(
			{
				key: doc.key,
				issuer,
				ticker: doc.ticker,
				company: doc.record.company,
				title: doc.record.title,
				category: doc.record.cvmCategory ?? null,
				documentType: doc.record.documentType ?? null,
				period: doc.record.period ?? null,
				publishedAt: doc.publishedAt.slice(0, 10),
				sourceUrl: doc.record.source.value,
			},
			resolved.content
		);
		await this.store.markIndexed(doc.key, now);
		return true;
	}

	private messageOf(err: unknown): string {
		return err instanceof Error ? err.message : String(err);
	}
}
