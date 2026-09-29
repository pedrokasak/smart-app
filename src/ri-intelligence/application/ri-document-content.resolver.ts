import { Inject, Injectable, Logger } from '@nestjs/common';
import {
	RI_DOCUMENT_CONTENT,
	RiDocumentContentPort,
	RiDocumentContentResult,
} from 'src/ri-intelligence/application/ri-document-content.port';
import {
	RI_DOCUMENT_TEXT_CACHE,
	RiDocumentTextCachePort,
} from 'src/ri-intelligence/application/ri-document-text-cache.port';
import { riDocumentTextKey } from 'src/ri-intelligence/domain/ri-document-text-key';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

/** Por que o texto do documento nao veio. */
export type RiContentUnavailableReason =
	| NonNullable<RiDocumentContentResult['reason']>
	/** Documento sem link de download (nao ha o que baixar). */
	| 'unsupported_source'
	/** So o cache foi consultado (`download: false`) e ele nao tinha. */
	| 'not_cached';

export interface ResolvedRiDocumentContent {
	/** O documento, marcado `extracted` quando o texto veio. */
	document: RiDocumentRecord;
	content: string | null;
	reason: RiContentUnavailableReason | null;
	from: 'cache' | 'download' | null;
}

export interface ResolveRiContentOptions {
	/**
	 * `false`: so o texto que ja estiver em cache, sem baixar o PDF. Para
	 * quem nao tem o resumo por IA no plano — baixar ate 25 MB para um
	 * resumo estruturado seria custo sem retorno.
	 */
	download?: boolean;
}

/**
 * Onde o texto de um documento de RI e obtido (TRA-253): um lugar so, para a
 * rota HTTP do resumo, o chat e o vigia de RI.
 *
 * Antes a regra "baixar o PDF quando o conteudo nao veio" morava dentro do
 * controller. O chat nao passava por ele: todo resumo de RI no chat recebia
 * texto vazio e parava em `insufficient_content`, mesmo no plano pago.
 *
 * Cache do texto primeiro (documento entregue nao muda); depois o download.
 * Nunca lanca: sem texto, devolve o motivo, e quem chama responde com o
 * resumo estruturado.
 */
@Injectable()
export class RiDocumentContentResolver {
	private readonly logger = new Logger(RiDocumentContentResolver.name);

	/** Documento publicado nao muda; o TTL so libera espaco. */
	private static readonly TEXT_TTL_SECONDS = 60 * 60 * 24 * 30;

	constructor(
		@Inject(RI_DOCUMENT_CONTENT)
		private readonly content: RiDocumentContentPort,
		@Inject(RI_DOCUMENT_TEXT_CACHE)
		private readonly texts: RiDocumentTextCachePort
	) {}

	async resolve(
		document: RiDocumentRecord,
		options: ResolveRiContentOptions = {}
	): Promise<ResolvedRiDocumentContent> {
		const url =
			document?.source?.type === 'url'
				? String(document.source.value || '').trim()
				: '';
		if (!url) return this.unavailable(document, 'unsupported_source');

		const key = riDocumentTextKey(url);
		const cached = key ? await this.readCache(key) : null;
		if (cached) return this.extracted(document, cached, 'cache');

		if (options.download === false) {
			return this.unavailable(document, 'not_cached');
		}

		const fetched = await this.content.fetchTextContent(url);
		if (!fetched.text) {
			return this.unavailable(document, fetched.reason ?? 'fetch_failed');
		}

		if (key) await this.writeCache(key, fetched.text);
		return this.extracted(document, fetched.text, 'download');
	}

	private extracted(
		document: RiDocumentRecord,
		content: string,
		from: 'cache' | 'download'
	): ResolvedRiDocumentContent {
		return {
			document: { ...document, contentStatus: 'extracted' },
			content,
			reason: null,
			from,
		};
	}

	private unavailable(
		document: RiDocumentRecord,
		reason: RiContentUnavailableReason
	): ResolvedRiDocumentContent {
		return { document, content: null, reason, from: null };
	}

	// O cache e atalho: falha nele vira download, nunca erro.
	private async readCache(key: string): Promise<string | null> {
		try {
			return await this.texts.get(key);
		} catch (err) {
			this.logger.warn(
				`Cache de texto de RI indisponivel: ${this.messageOf(err)}`
			);
			return null;
		}
	}

	private async writeCache(key: string, text: string): Promise<void> {
		try {
			await this.texts.set(
				key,
				text,
				RiDocumentContentResolver.TEXT_TTL_SECONDS
			);
		} catch (err) {
			this.logger.warn(
				`Falha ao guardar texto de RI em cache: ${this.messageOf(err)}`
			);
		}
	}

	private messageOf(err: unknown): string {
		return err instanceof Error ? err.message : String(err);
	}
}
