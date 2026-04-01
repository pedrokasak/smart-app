import { Injectable } from '@nestjs/common';
import {
	RiDocumentDiscoveryInput,
	RiDocumentDiscoveryPort,
} from 'src/ri-intelligence/application/ri-document-discovery.port';
import { classifyRiDocumentType } from 'src/ri-intelligence/domain/ri-document-classifier';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

interface RawLinkCandidate {
	url: string;
	title: string;
}

@Injectable()
export class HttpRiDocumentDiscoveryAdapter implements RiDocumentDiscoveryPort {
	private readonly requestTimeoutMs = 4500;
	private readonly maxPagesToScan = 10;
	private readonly maxDocuments = 40;
	private readonly crawlerSignature =
		'Mozilla/5.0 (compatible; TrackerrRIBot/1.0; +https://trackerr.app)';

	async discover(input: RiDocumentDiscoveryInput): Promise<RiDocumentRecord[]> {
		const origin = this.normalizeOrigin(input.origin);
		if (!origin) return [];

		const scanTargets = this.buildScanTargets(origin).slice(
			0,
			this.maxPagesToScan
		);
		const candidates: RawLinkCandidate[] = [];

		for (const target of scanTargets) {
			const html = await this.fetchHtml(target);
			if (!html) continue;
			candidates.push(...this.extractLinksFromHtml(html, target));
		}

		if (!candidates.length) return [];

		const uniqueByUrl = new Map<string, RawLinkCandidate>();
		for (const candidate of candidates) {
			if (!this.isLikelyRiDocument(candidate)) continue;
			if (!uniqueByUrl.has(candidate.url)) {
				uniqueByUrl.set(candidate.url, candidate);
			}
		}

		const nowIso = new Date().toISOString();
		const records = Array.from(uniqueByUrl.values())
			.map((candidate, index) => {
				const classified = classifyRiDocumentType({
					title: candidate.title,
					url: candidate.url,
				});
				const publishedAt = this.extractPublishedAt(candidate) || nowIso;
				return {
					id: `${input.ticker}:${classified.documentType}:${publishedAt}:${index}:http`,
					ticker: input.ticker,
					company: input.company,
					title: candidate.title,
					documentType: classified.documentType,
					period: this.extractPeriod(candidate),
					publishedAt,
					source: {
						type: 'url' as const,
						value: candidate.url,
					},
					classification: {
						method: 'deterministic_rules' as const,
						confidence: classified.confidence,
						score: classified.score,
						matchedAliases: classified.matchedAliases,
					},
					contentStatus: 'metadata_only' as const,
				} satisfies RiDocumentRecord;
			})
			.sort(
				(a, b) =>
					new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
			)
			.slice(0, this.maxDocuments);

		return records;
	}

	private buildScanTargets(origin: string): string[] {
		const paths = [
			'/',
			'/ri',
			'/relacoes-com-investidores',
			'/relacao-com-investidores',
			'/investor-relations',
			'/fatos-relevantes',
			'/fato-relevante',
			'/comunicados',
			'/resultados',
			'/central-de-resultados',
			'/informacoes-financeiras',
			'/documentos',
			'/governanca-corporativa',
		];

		const unique = new Set<string>();
		for (const path of paths) {
			try {
				unique.add(new URL(path, origin).toString());
			} catch {
				// ignore malformed candidate
			}
		}
		return Array.from(unique);
	}

	private normalizeOrigin(origin: string): string | null {
		try {
			const parsed = new URL(String(origin || '').trim());
			if (!['http:', 'https:'].includes(parsed.protocol)) return null;
			return parsed.origin;
		} catch {
			return null;
		}
	}

	private async fetchHtml(url: string): Promise<string | null> {
		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			this.requestTimeoutMs
		);
		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'User-Agent': this.crawlerSignature,
					Accept: 'text/html,application/xhtml+xml',
				},
				signal: controller.signal,
			});
			if (!response.ok) return null;
			const contentType = String(
				response.headers.get('content-type') || ''
			).toLowerCase();
			if (!contentType.includes('text/html')) return null;
			return response.text();
		} catch {
			return null;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private extractLinksFromHtml(
		html: string,
		baseUrl: string
	): RawLinkCandidate[] {
		const links: RawLinkCandidate[] = [];
		const anchorRegex =
			/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
		for (const match of html.matchAll(anchorRegex)) {
			const href = String(match[1] || '').trim();
			if (!href) continue;
			const resolved = this.resolveUrl(href, baseUrl);
			if (!resolved) continue;
			const text = this.sanitizeHtmlText(match[2] || '');
			links.push({
				url: resolved,
				title: text || this.readableFileName(resolved),
			});
		}

		const directPdfRegex = /(https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?)/gi;
		for (const match of html.matchAll(directPdfRegex)) {
			const resolved = this.resolveUrl(String(match[1] || '').trim(), baseUrl);
			if (!resolved) continue;
			links.push({
				url: resolved,
				title: this.readableFileName(resolved),
			});
		}

		return links;
	}

	private resolveUrl(candidate: string, baseUrl: string): string | null {
		const normalized = String(candidate || '').trim();
		if (!normalized) return null;
		if (normalized.startsWith('javascript:')) return null;
		if (normalized.startsWith('#')) return null;
		try {
			const resolved = new URL(normalized, baseUrl).toString();
			if (!resolved.startsWith('http://') && !resolved.startsWith('https://'))
				return null;
			return resolved;
		} catch {
			return null;
		}
	}

	private sanitizeHtmlText(raw: string): string {
		return String(raw || '')
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;/gi, ' ')
			.replace(/&amp;/gi, '&')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private readableFileName(url: string): string {
		const path = String(url || '')
			.split('?')[0]
			.split('#')[0];
		const last = path.split('/').pop() || path;
		return decodeURIComponent(last)
			.replace(/[_-]+/g, ' ')
			.replace(/\.pdf$/i, '')
			.trim();
	}

	private isLikelyRiDocument(candidate: RawLinkCandidate): boolean {
		const context = `${candidate.url} ${candidate.title}`.toLowerCase();
		const hasPdfExtension = candidate.url.toLowerCase().includes('.pdf');
		const hasRiHint = [
			'fato relevante',
			'comunicado ao mercado',
			'release',
			'resultados',
			'apresentacao',
			'demonstracoes',
			'dividend',
			'jcp',
			'acionista',
			'relacoes-com-investidores',
			'investor',
		].some((keyword) => context.includes(keyword));

		return hasPdfExtension || hasRiHint;
	}

	private extractPublishedAt(candidate: RawLinkCandidate): string | null {
		const normalized = `${candidate.url} ${candidate.title}`;
		const yyyyMmDd = normalized.match(
			/(20\d{2})[-_/](0[1-9]|1[0-2])[-_/](0[1-9]|[12]\d|3[01])/
		);
		if (yyyyMmDd) {
			return new Date(
				`${yyyyMmDd[1]}-${yyyyMmDd[2]}-${yyyyMmDd[3]}T00:00:00.000Z`
			).toISOString();
		}
		const ddMmYyyy = normalized.match(
			/(0[1-9]|[12]\d|3[01])[-_/](0[1-9]|1[0-2])[-_/](20\d{2})/
		);
		if (ddMmYyyy) {
			return new Date(
				`${ddMmYyyy[3]}-${ddMmYyyy[2]}-${ddMmYyyy[1]}T00:00:00.000Z`
			).toISOString();
		}
		const yearMonthFolder = normalized.match(
			/(20\d{2})[\/_-](0[1-9]|1[0-2])[\/_-]/
		);
		if (yearMonthFolder) {
			return new Date(
				`${yearMonthFolder[1]}-${yearMonthFolder[2]}-01T00:00:00.000Z`
			).toISOString();
		}
		return null;
	}

	private extractPeriod(candidate: RawLinkCandidate): string | null {
		const normalized = `${candidate.title} ${candidate.url}`.toUpperCase();
		const quarter = normalized.match(/([1-4]T\d{2})/);
		if (quarter) return quarter[1];
		const year = normalized.match(/\b(20\d{2})\b/);
		if (year) return year[1];
		return null;
	}
}
