import { Injectable, Logger } from '@nestjs/common';
import {
	RiDocumentDiscoveryInput,
	RiDocumentDiscoveryPort,
} from 'src/ri-intelligence/application/ri-document-discovery.port';
import { classifyRiDocumentType } from 'src/ri-intelligence/domain/ri-document-classifier';
import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';
import { PuppeteerBrowserPool } from './puppeteer-browser-pool.service';

interface RawLinkCandidate {
	url: string;
	title: string;
}

@Injectable()
export class PuppeteerRiDocumentDiscoveryAdapter implements RiDocumentDiscoveryPort {
	private readonly maxDocuments = 40;
	private readonly logger = new Logger(
		PuppeteerRiDocumentDiscoveryAdapter.name
	);

	constructor(private readonly browserPool: PuppeteerBrowserPool) {}

	async discover(input: RiDocumentDiscoveryInput): Promise<RiDocumentRecord[]> {
		const origin = this.normalizeOrigin(input.origin);
		if (!origin) return [];

		this.logger.log(
			`Starting headless discovery for ${input.ticker} at ${origin}`
		);
		const candidates: RawLinkCandidate[] = [];

		// Usa o browser compartilhado do pool (lazy singleton, reuso entre
		// chamadas) em vez de `puppeteer.launch()` por chamada. A página é
		// fechada pelo pool no finally; o browser permanece aberto.
		await this.browserPool
			.withPage(async (page) => {
				const scanTargets = [
					origin,
					new URL('/resultados', origin).toString(),
					new URL('/fatos-relevantes', origin).toString(),
					new URL('/comunicados', origin).toString(),
					new URL('/ri', origin).toString(),
				].filter((v, i, a) => a.indexOf(v) === i); // unique

				for (const target of scanTargets) {
					try {
						this.logger.log(`Puppeteer navigating to ${target}`);
						await page.goto(target, {
							waitUntil: 'networkidle2',
							timeout: 15000,
						});

						const links = await page.evaluate(() => {
							const anchors = Array.from(document.querySelectorAll('a'));
							return anchors.map((a) => ({
								url: a.href,
								title: a.innerText || a.textContent || '',
							}));
						});

						for (const link of links) {
							const resolved = this.resolveUrl(link.url, origin);
							if (!resolved) continue;
							const title =
								this.sanitizeText(link.title) ||
								this.readableFileName(resolved);
							candidates.push({ url: resolved, title });
						}
					} catch (navError) {
						this.logger.warn(`Failed to scan target: ${target}`);
					}
				}
			})
			.catch((error) => {
				// Pool indisponível/-browser não relançável: loga e segue com o que
				// já foi coletado (candidates pode ter parte do scan feito antes do
				// erro). Comportamento análogo ao `catch` do bloco launch antigo.
				this.logger.error(
					`Error in headless discovery for ${input.ticker}: ${error?.message || error}`
				);
			});

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
					id: `${input.ticker}:${classified.documentType}:${publishedAt}:${index}:puppeteer`,
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

		this.logger.log(
			`Found ${records.length} documents via Puppeteer for ${input.ticker}`
		);
		return records;
	}

	private normalizeOrigin(origin: string | null): string | null {
		try {
			const parsed = new URL(String(origin || '').trim());
			if (!['http:', 'https:'].includes(parsed.protocol)) return null;
			return parsed.origin;
		} catch {
			return null;
		}
	}

	private resolveUrl(candidate: string, baseUrl: string): string | null {
		const normalized = String(candidate || '').trim();
		if (
			!normalized ||
			normalized.startsWith('javascript:') ||
			normalized.startsWith('mailto:') ||
			normalized.startsWith('tel:') ||
			normalized.startsWith('#')
		)
			return null;
		try {
			const resolved = new URL(normalized, baseUrl).toString();
			if (!resolved.startsWith('http')) return null;
			return resolved;
		} catch {
			return null;
		}
	}

	private sanitizeText(raw: string): string {
		return String(raw || '')
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
			'comunicado',
			'release',
			'resultados',
			'apresentacao',
			'demonstracoes',
			'dividend',
			'jcp',
			'acionista',
			'investor',
			'guidance',
			'relatorio',
		].some((k) => context.includes(k));
		return hasPdfExtension || hasRiHint;
	}

	private extractPublishedAt(candidate: RawLinkCandidate): string | null {
		const normalized = `${candidate.url} ${candidate.title}`;
		const yyyyMmDd = normalized.match(
			/(20\d{2})[-_/](0[1-9]|1[0-2])[-_/](0[1-9]|[12]\d|3[01])/
		);
		if (yyyyMmDd)
			return new Date(
				`${yyyyMmDd[1]}-${yyyyMmDd[2]}-${yyyyMmDd[3]}T00:00:00.000Z`
			).toISOString();
		return null;
	}

	private extractPeriod(candidate: RawLinkCandidate): string | null {
		const normalized = `${candidate.title} ${candidate.url}`.toUpperCase();
		const quarter = normalized.match(/([1-4]T\d{2})/);
		if (quarter) return quarter[1];
		return null;
	}
}
