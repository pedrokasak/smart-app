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
	private readonly maxSitemapFiles = 10;
	private readonly maxSitemapUrls = 200;
	private readonly crawlerSignature =
		'Mozilla/5.0 (compatible; TrackerrRIBot/1.0; +https://trackerr.app)';

	async discover(input: RiDocumentDiscoveryInput): Promise<RiDocumentRecord[]> {
		const origin = this.normalizeOrigin(input.origin);
		if (!origin) return [];

		const sitemapDiscovery = await this.discoverFromSitemaps(origin);
		const scanTargets = [
			...this.buildScanTargets(origin),
			...sitemapDiscovery.pageTargets,
		];
		const queued = new Set<string>(scanTargets);
		const visited = new Set<string>();
		const queue = [...scanTargets];
		const candidates: RawLinkCandidate[] = [
			...sitemapDiscovery.documentCandidates,
		];

		while (queue.length > 0 && visited.size < this.maxPagesToScan) {
			const target = queue.shift();
			if (!target || visited.has(target)) continue;
			visited.add(target);

			const html = await this.fetchHtml(target);
			if (!html) continue;

			candidates.push(...this.extractLinksFromHtml(html, target));

			const navigationTargets = this.extractNavigationTargetsFromHtml(
				html,
				target,
				origin
			);
			for (const nextTarget of navigationTargets) {
				if (visited.has(nextTarget) || queued.has(nextTarget)) continue;
				queue.unshift(nextTarget);
				queued.add(nextTarget);
			}
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

	private async discoverFromSitemaps(origin: string): Promise<{
		pageTargets: string[];
		documentCandidates: RawLinkCandidate[];
	}> {
		const sitemapEntries = await this.resolveSitemapEntryPoints(origin);
		if (!sitemapEntries.length) {
			return { pageTargets: [], documentCandidates: [] };
		}

		const queue = [...sitemapEntries].slice(0, this.maxSitemapFiles);
		const visited = new Set<string>();
		const pageTargets = new Set<string>();
		const documentCandidates = new Map<string, RawLinkCandidate>();
		let scannedUrls = 0;

		while (
			queue.length > 0 &&
			visited.size < this.maxSitemapFiles &&
			scannedUrls < this.maxSitemapUrls
		) {
			const sitemapUrl = queue.shift();
			if (!sitemapUrl || visited.has(sitemapUrl)) continue;
			visited.add(sitemapUrl);

			const xml = await this.fetchXml(sitemapUrl);
			if (!xml) continue;

			const locs = this.extractSitemapLocs(xml);
			for (const loc of locs) {
				if (scannedUrls >= this.maxSitemapUrls) break;
				scannedUrls += 1;
				if (!this.isSameSite(loc, origin)) continue;

				if (this.looksLikeSitemap(loc) && !visited.has(loc)) {
					queue.push(loc);
					continue;
				}

				if (this.isLikelyDocumentUrl(loc)) {
					if (!documentCandidates.has(loc)) {
						documentCandidates.set(loc, {
							url: loc,
							title: this.readableFileName(loc),
						});
					}
					continue;
				}

				if (this.isLikelyRiNavigation(loc, '')) {
					pageTargets.add(loc);
				}
			}
		}

		return {
			pageTargets: Array.from(pageTargets),
			documentCandidates: Array.from(documentCandidates.values()),
		};
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

	private async resolveSitemapEntryPoints(origin: string): Promise<string[]> {
		const defaults = [
			'/sitemap.xml',
			'/sitemap_index.xml',
			'/sitemap-index.xml',
			'/sitemap/sitemap.xml',
		].map((path) => {
			try {
				return new URL(path, origin).toString();
			} catch {
				return null;
			}
		});

		const robotsEntries = await this.extractSitemapsFromRobots(origin);
		return Array.from(
			new Set(
				[...defaults, ...robotsEntries]
					.filter((value): value is string => Boolean(value))
					.filter((value) => this.isSameSite(value, origin))
			)
		);
	}

	private async extractSitemapsFromRobots(origin: string): Promise<string[]> {
		const robotsUrl = (() => {
			try {
				return new URL('/robots.txt', origin).toString();
			} catch {
				return null;
			}
		})();
		if (!robotsUrl) return [];

		const content = await this.fetchText(
			robotsUrl,
			'text/plain,text/*,*/*;q=0.1'
		);
		if (!content) return [];

		const output = new Set<string>();
		for (const line of content.split('\n')) {
			const match = line.match(/^\s*sitemap:\s*(\S+)\s*$/i);
			if (!match) continue;
			const candidate = this.resolveUrl(match[1], robotsUrl);
			if (!candidate) continue;
			output.add(candidate);
		}
		return Array.from(output);
	}

	private async fetchXml(url: string): Promise<string | null> {
		const content = await this.fetchText(
			url,
			'application/xml,text/xml,text/plain,*/*;q=0.1'
		);
		if (!content) return null;
		const normalized = content.trim().toLowerCase();
		if (!normalized) return null;
		return normalized.includes('<urlset') ||
			normalized.includes('<sitemapindex')
			? content
			: null;
	}

	private extractSitemapLocs(xml: string): string[] {
		const output = new Set<string>();
		const locRegex = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
		for (const match of xml.matchAll(locRegex)) {
			const decoded = this.decodeXmlEntities(String(match[1] || '').trim());
			if (!decoded) continue;
			const resolved = this.normalizeAbsoluteHttpUrl(decoded);
			if (!resolved) continue;
			output.add(resolved);
		}
		return Array.from(output);
	}

	private normalizeAbsoluteHttpUrl(value: string): string | null {
		try {
			const parsed = new URL(value);
			if (!['http:', 'https:'].includes(parsed.protocol)) return null;
			return parsed.toString();
		} catch {
			return null;
		}
	}

	private decodeXmlEntities(value: string): string {
		return value
			.replace(/&amp;/gi, '&')
			.replace(/&lt;/gi, '<')
			.replace(/&gt;/gi, '>')
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'");
	}

	private extractNavigationTargetsFromHtml(
		html: string,
		baseUrl: string,
		origin: string
	): string[] {
		const targets = new Set<string>();
		const anchorRegex =
			/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

		for (const match of html.matchAll(anchorRegex)) {
			const href = String(match[1] || '').trim();
			if (!href) continue;
			const resolved = this.resolveUrl(href, baseUrl);
			if (!resolved) continue;
			if (!this.isSameSite(resolved, origin)) continue;

			const title = this.sanitizeHtmlText(match[2] || '');
			if (!this.isLikelyRiNavigation(resolved, title)) continue;
			targets.add(resolved);
		}

		return Array.from(targets);
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
		const content = await this.fetchText(
			url,
			'text/html,application/xhtml+xml'
		);
		if (!content) return null;
		return content;
	}

	private async fetchText(url: string, accept: string): Promise<string | null> {
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
					Accept: accept,
				},
				signal: controller.signal,
			});
			if (!response.ok) return null;
			const contentType = String(response.headers.get('content-type') || '')
				.toLowerCase()
				.trim();
			if (accept.includes('text/html') && !contentType.includes('text/html')) {
				return null;
			}
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
		if (normalized.startsWith('mailto:')) return null;
		if (normalized.startsWith('tel:')) return null;
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
			'guidance',
			'outlook',
		].some((keyword) => context.includes(keyword));

		return hasPdfExtension || hasRiHint;
	}

	private isLikelyRiNavigation(url: string, title: string): boolean {
		const pathname = this.safePathname(url).toLowerCase();
		if (
			[
				'.pdf',
				'.doc',
				'.docx',
				'.ppt',
				'.pptx',
				'.xls',
				'.xlsx',
				'.zip',
				'.png',
				'.jpg',
				'.jpeg',
				'.gif',
				'.svg',
				'.css',
				'.js',
			].some((suffix) => pathname.endsWith(suffix))
		) {
			return false;
		}

		const context = `${url} ${title}`.toLowerCase();
		return [
			'/ri',
			'investor',
			'investidores',
			'relacoes-com-investidores',
			'comunicados',
			'resultados',
			'apresenta',
			'relator',
			'fato-relevante',
			'financial',
			'earnings',
			'press-release',
			'documentos',
			'downloads',
		].some((keyword) => context.includes(keyword));
	}

	private looksLikeSitemap(url: string): boolean {
		const pathname = this.safePathname(url).toLowerCase();
		return pathname.endsWith('.xml') && pathname.includes('sitemap');
	}

	private isLikelyDocumentUrl(url: string): boolean {
		const pathname = this.safePathname(url).toLowerCase();
		if (
			['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.zip'].some(
				(suffix) => pathname.endsWith(suffix)
			)
		) {
			return true;
		}

		const context = url.toLowerCase();
		return [
			'/documents/d/',
			'/download',
			'/downloads/',
			'release',
			'resultados',
			'fato-relevante',
			'comunicado',
			'investor',
			'relatorio',
		].some((keyword) => context.includes(keyword));
	}

	private isSameSite(url: string, origin: string): boolean {
		try {
			const hostA = new URL(url).hostname.toLowerCase();
			const hostB = new URL(origin).hostname.toLowerCase();
			if (hostA === hostB) return true;
			return hostA.endsWith(`.${hostB}`) || hostB.endsWith(`.${hostA}`);
		} catch {
			return false;
		}
	}

	private safePathname(url: string): string {
		try {
			return new URL(url).pathname;
		} catch {
			return '';
		}
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
