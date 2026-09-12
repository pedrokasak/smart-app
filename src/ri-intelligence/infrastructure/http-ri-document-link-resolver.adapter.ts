import { Injectable } from '@nestjs/common';
import {
	ResolveRiDocumentLinkInput,
	ResolveRiDocumentLinkResult,
	RiDocumentLinkResolverPort,
} from 'src/ri-intelligence/application/ri-document-link-resolver.port';

const ALLOWED_CONTENT_TYPE_SNIPPETS = [
	'application/pdf',
	'application/octet-stream',
	'binary/octet-stream',
	'application/msword',
	'application/vnd',
];

const ALLOWED_FILE_EXTENSIONS = [
	'.pdf',
	'.doc',
	'.docx',
	'.ppt',
	'.pptx',
	'.xls',
	'.xlsx',
	'.zip',
];

@Injectable()
export class HttpRiDocumentLinkResolverAdapter implements RiDocumentLinkResolverPort {
	private readonly timeoutMs = 8000;

	async resolve(
		input: ResolveRiDocumentLinkInput
	): Promise<ResolveRiDocumentLinkResult> {
		const rawUrl = String(input.url || '').trim();
		if (!rawUrl) {
			return this.invalid('empty_url');
		}

		const absoluteUrl = this.toAbsoluteUrl(rawUrl, input.origin);
		if (!absoluteUrl) {
			return this.invalid(
				this.isAbsolute(rawUrl) ? 'invalid_url' : 'relative_url_without_origin'
			);
		}

		const response = await this.fetchResolvedResponse(absoluteUrl);
		if (!response) {
			return this.invalid('unreachable');
		}

		const finalUrl = String(response.url || absoluteUrl);
		const isExplicitPdf = this.safePathname(finalUrl)
			.toLowerCase()
			.endsWith('.pdf');

		if (!response.ok) {
			this.cancelBody(response);
			if (isExplicitPdf) {
				return {
					isValid: true,
					resolvedUrl: finalUrl,
					statusCode: response.status,
					contentType: 'application/pdf',
				};
			}
			return {
				...this.invalid('invalid_http_status'),
				resolvedUrl: finalUrl,
				statusCode: response.status,
			};
		}

		if (this.isKnownErrorRoute(finalUrl)) {
			this.cancelBody(response);
			return {
				...this.invalid('known_error_route'),
				resolvedUrl: finalUrl,
				statusCode: response.status,
			};
		}

		const contentType = this.normalizeContentType(
			response.headers.get('content-type')
		);
		if (!this.isSupportedContentType(contentType, finalUrl)) {
			this.cancelBody(response);
			return {
				...this.invalid('invalid_content_type'),
				resolvedUrl: finalUrl,
				statusCode: response.status,
				contentType,
			};
		}

		this.cancelBody(response);
		return {
			isValid: true,
			resolvedUrl: finalUrl,
			statusCode: response.status,
			contentType,
		};
	}

	private async fetchResolvedResponse(url: string): Promise<Response | null> {
		const head = await this.request(url, 'HEAD');
		if (head && head.ok) return head;

		const status = head?.status;
		if (!head || status === 403 || status === 405 || status === 406) {
			if (head) this.cancelBody(head);
			return this.request(url, 'GET');
		}

		return head;
	}

	private async request(
		url: string,
		method: 'HEAD' | 'GET'
	): Promise<Response | null> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			return await fetch(url, {
				method,
				redirect: 'follow',
				headers:
					method === 'GET'
						? {
								Range: 'bytes=0-0',
								Accept:
									'application/pdf,application/octet-stream,application/msword,*/*;q=0.5',
							}
						: undefined,
				signal: controller.signal,
			});
		} catch {
			return null;
		} finally {
			clearTimeout(timeout);
		}
	}

	private toAbsoluteUrl(rawUrl: string, origin?: string): string | null {
		try {
			return new URL(rawUrl).toString();
		} catch {
			const base = String(origin || '').trim();
			if (!base) return null;
			try {
				return new URL(rawUrl, base).toString();
			} catch {
				return null;
			}
		}
	}

	private isAbsolute(url: string): boolean {
		return /^https?:\/\//i.test(url);
	}

	private isKnownErrorRoute(url: string): boolean {
		return (
			/\/error\/404(?:[/?#]|$)/i.test(url) ||
			/\/404(?:[/?#]|$)/i.test(url) ||
			/mziq\.com\/.*\/error\//i.test(url)
		);
	}

	private normalizeContentType(value: string | null): string | null {
		const contentType = String(value || '')
			.trim()
			.toLowerCase();
		return contentType || null;
	}

	private isSupportedContentType(
		contentType: string | null,
		resolvedUrl: string
	): boolean {
		if (contentType) {
			if (contentType.includes('text/html')) return false;
			if (
				ALLOWED_CONTENT_TYPE_SNIPPETS.some((snippet) =>
					contentType.includes(snippet)
				)
			) {
				return true;
			}
		}

		const pathname = this.safePathname(resolvedUrl).toLowerCase();
		return ALLOWED_FILE_EXTENSIONS.some((ext) => pathname.endsWith(ext));
	}

	private safePathname(url: string): string {
		try {
			return new URL(url).pathname;
		} catch {
			return '';
		}
	}

	private cancelBody(response: Response): void {
		response.body?.cancel().catch(() => undefined);
	}

	private invalid(
		rejectionReason: ResolveRiDocumentLinkResult['rejectionReason']
	): ResolveRiDocumentLinkResult {
		return {
			isValid: false,
			resolvedUrl: null,
			statusCode: null,
			contentType: null,
			rejectionReason,
		};
	}
}
