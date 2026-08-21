// Polyfill de DOM DEVE vir antes de 'pdf-parse' (pdfjs) — ver o módulo.
import 'src/common/pdf/pdf-node-polyfill';
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { PDFParse } from 'pdf-parse';
import {
	RiDocumentContentPort,
	RiDocumentContentResult,
} from 'src/ri-intelligence/application/ri-document-content.port';
import {
	RI_DOCUMENT_LINK_RESOLVER,
	RiDocumentLinkResolverPort,
} from 'src/ri-intelligence/application/ri-document-link-resolver.port';

/**
 * Busca o PDF de um documento de RI e extrai o texto (TRA-85).
 *
 * Fluxo: valida a URL pelo `RiDocumentLinkResolverPort` (que ja checa
 * status, content-type e rotas de erro conhecidas — a mesma guarda usada na
 * descoberta), baixa os bytes com teto de tamanho, e extrai o texto com
 * `PDFParse` (mesma lib usada no broker-sync).
 *
 * Guardas deliberadas:
 * - Teto de bytes: um PDF de centenas de MB nao pode derrubar o processo. A
 *   resposta e truncada no limite e tratada como erro, nao silenciosamente
 *   parcial.
 * - So application/pdf: o resolver ja rejeita content-type invalido, mas a
 *   dupla checagem aqui evita passar um HTML de erro pro PDFParse.
 * - Nunca lanca: falha de rede/parse vira `text: null` com motivo. O
 *   chamador (fluxo de resumo) trata ausencia de conteudo como caso
 *   esperado, nao como excecao.
 */
@Injectable()
export class HttpPdfRiDocumentContentAdapter implements RiDocumentContentPort {
	private readonly logger = new Logger(HttpPdfRiDocumentContentAdapter.name);

	private static readonly MAX_BYTES = 25 * 1024 * 1024; // 25 MB
	private static readonly FETCH_TIMEOUT_MS = 15000;

	constructor(
		private readonly httpService: HttpService,
		@Inject(RI_DOCUMENT_LINK_RESOLVER)
		private readonly linkResolver: RiDocumentLinkResolverPort
	) {}

	async fetchTextContent(url: string): Promise<RiDocumentContentResult> {
		if (!url || !url.trim()) {
			return { text: null, reason: 'empty_url' };
		}

		const resolved = await this.linkResolver.resolve({ url });
		if (!resolved.isValid || !resolved.resolvedUrl) {
			return { text: null, reason: 'link_invalid' };
		}
		if (
			resolved.contentType &&
			!resolved.contentType.toLowerCase().includes('pdf')
		) {
			return { text: null, reason: 'not_pdf' };
		}

		let buffer: Buffer;
		try {
			const response = await firstValueFrom(
				this.httpService.get<ArrayBuffer>(resolved.resolvedUrl, {
					responseType: 'arraybuffer',
					timeout: HttpPdfRiDocumentContentAdapter.FETCH_TIMEOUT_MS,
					maxContentLength: HttpPdfRiDocumentContentAdapter.MAX_BYTES,
					maxBodyLength: HttpPdfRiDocumentContentAdapter.MAX_BYTES,
					headers: {
						Accept: 'application/pdf,application/octet-stream,*/*;q=0.5',
					},
				})
			);
			buffer = Buffer.from(response.data);
		} catch (error) {
			// axios lanca em maxContentLength excedido; distingue do resto pra
			// dar um motivo util no log.
			const tooLarge = /maxContentLength|maxBodyLength/i.test(
				error?.message || ''
			);
			this.logger.warn(
				`Falha ao baixar PDF de RI (${resolved.resolvedUrl}): ${error?.message}`
			);
			return {
				text: null,
				reason: tooLarge ? 'too_large' : 'fetch_failed',
			};
		}

		if (buffer.length > HttpPdfRiDocumentContentAdapter.MAX_BYTES) {
			return { text: null, reason: 'too_large', bytes: buffer.length };
		}

		try {
			const parser = new PDFParse({ data: buffer });
			const parsed = await parser.getText();
			const text = String(
				(parsed as { text?: string; document?: string })?.text ||
					(parsed as { text?: string; document?: string })?.document ||
					''
			).trim();
			await parser.destroy();

			if (!text) {
				// PDF de imagem escaneada sem camada de texto cai aqui. E um caso
				// real de RI (scans de atas de assembleia), sinalizado explicito
				// pro chamador nao confundir com falha de rede.
				return {
					text: null,
					reason: 'empty_after_extract',
					bytes: buffer.length,
				};
			}
			return { text, bytes: buffer.length };
		} catch (error) {
			this.logger.warn(
				`Falha ao extrair texto do PDF de RI (${resolved.resolvedUrl}): ${error?.message}`
			);
			return { text: null, reason: 'extract_failed', bytes: buffer.length };
		}
	}
}
