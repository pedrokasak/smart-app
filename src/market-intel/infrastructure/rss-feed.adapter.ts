import { Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import {
	FeedItem,
	FetchResult,
	MarketFeedFetcher,
} from 'src/market-intel/application/market-intel.ports';
import { MarketSource } from 'src/market-intel/domain/market-intel.types';

const MAX_DESCRIPTION_B = 300;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Adapter RSS para ingestão de notícias (ADR-004, camadas A e B).
 *
 * Camada A: título + descrição completa (fontes oficiais: CVM, BCB, B3…).
 * Camada B: título + descrição truncada em 300 chars (portais privados).
 *
 * Suporta ETag / Last-Modified para evitar re-download quando feed não mudou.
 * Respeita robots.txt implicitamente via `Crawl-delay` não implementado aqui —
 * o scheduler garante espaço entre chamadas de fontes do mesmo domínio.
 */
@Injectable()
export class RssFeedAdapter implements MarketFeedFetcher {
	private readonly logger = new Logger(RssFeedAdapter.name);
	private readonly parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@_',
		isArray: (name) =>
			['item', 'entry', 'channel'].includes(name),
	});

	async fetch(source: MarketSource): Promise<FetchResult> {
		const headers: Record<string, string> = {
			'User-Agent': 'Trackerr/1.0 (+https://trackerr.com.br; bot)',
			Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
		};
		if (source.etag) headers['If-None-Match'] = source.etag;
		if (source.lastModified) headers['If-Modified-Since'] = source.lastModified;

		let response: Response;
		try {
			response = await fetch(source.feedUrl, {
				headers,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logger.warn(`Fetch falhou [${source.id}] ${source.feedUrl}: ${msg}`);
			throw err;
		}

		if (response.status === 304) {
			return { items: null, etag: source.etag, lastModified: source.lastModified };
		}

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ao buscar ${source.feedUrl}`);
		}

		const etag = response.headers.get('ETag') ?? null;
		const lastModified = response.headers.get('Last-Modified') ?? null;
		const body = await response.text();

		const items = this.parse(body, source);
		return { items, etag, lastModified };
	}

	private parse(xml: string, source: MarketSource): FeedItem[] {
		let parsed: Record<string, unknown>;
		try {
			parsed = this.parser.parse(xml) as Record<string, unknown>;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(`XML inválido de ${source.feedUrl}: ${msg}`);
		}

		// RSS 2.0: rss.channel[0].item[]
		const rssItems = this.extractRssItems(parsed);
		if (rssItems.length) return rssItems.map((i) => this.normalizeItem(i, source));

		// Atom: feed.entry[]
		const atomItems = this.extractAtomItems(parsed);
		return atomItems.map((i) => this.normalizeAtomItem(i, source));
	}

	private extractRssItems(parsed: Record<string, unknown>): unknown[] {
		const rss = parsed['rss'] as Record<string, unknown> | undefined;
		if (!rss) return [];
		const channels = rss['channel'] as Array<Record<string, unknown>> | undefined;
		if (!channels?.length) return [];
		const items = channels[0]['item'] as unknown[] | undefined;
		return Array.isArray(items) ? items : [];
	}

	private extractAtomItems(parsed: Record<string, unknown>): unknown[] {
		const feed = parsed['feed'] as Record<string, unknown> | undefined;
		if (!feed) return [];
		const entries = feed['entry'] as unknown[] | undefined;
		return Array.isArray(entries) ? entries : [];
	}

	private normalizeItem(
		raw: unknown,
		source: MarketSource
	): FeedItem {
		const item = raw as Record<string, unknown>;
		const title = this.str(item['title']) ?? '';
		const rawDesc =
			this.str(item['description']) ??
			this.str(item['content:encoded']) ??
			'';
		const description = source.layer === 'B'
			? this.stripHtml(rawDesc).slice(0, MAX_DESCRIPTION_B)
			: this.stripHtml(rawDesc);
		const url =
			this.str(item['link']) ??
			this.str((item['guid'] as Record<string, unknown>)?.['#text']) ??
			this.str(item['guid']) ??
			'';
		const publishedAt = this.parseDate(
			this.str(item['pubDate']) ?? this.str(item['dc:date'])
		);
		const author =
			this.str(item['dc:creator']) ??
			this.str(item['author']) ??
			null;
		return { title, description, url, publishedAt, author };
	}

	private normalizeAtomItem(
		raw: unknown,
		source: MarketSource
	): FeedItem {
		const entry = raw as Record<string, unknown>;
		const title =
			this.str(entry['title']) ??
			this.str((entry['title'] as Record<string, unknown>)?.['#text']) ??
			'';
		const rawContent =
			this.str(entry['content']) ??
			this.str(entry['summary']) ??
			'';
		const description = source.layer === 'B'
			? this.stripHtml(rawContent).slice(0, MAX_DESCRIPTION_B)
			: this.stripHtml(rawContent);
		const links = entry['link'] as unknown;
		const url = this.extractAtomLink(links);
		const publishedAt = this.parseDate(
			this.str(entry['published']) ?? this.str(entry['updated'])
		);
		const authorObj = entry['author'] as Record<string, unknown> | undefined;
		const author = authorObj
			? (this.str(authorObj['name']) ?? null)
			: null;
		return { title, description, url, publishedAt, author };
	}

	private extractAtomLink(links: unknown): string {
		if (!links) return '';
		if (typeof links === 'string') return links;
		if (Array.isArray(links)) {
			const alt = (links as Array<Record<string, unknown>>).find(
				(l) => !l['@_rel'] || l['@_rel'] === 'alternate'
			);
			return this.str(alt?.['@_href']) ?? '';
		}
		const obj = links as Record<string, unknown>;
		return this.str(obj['@_href']) ?? this.str(obj) ?? '';
	}

	private str(v: unknown): string | null {
		if (v === null || v === undefined) return null;
		if (typeof v === 'string') return v.trim() || null;
		if (typeof v === 'object' && '#text' in (v as object)) {
			return this.str((v as Record<string, unknown>)['#text']);
		}
		return null;
	}

	private stripHtml(html: string): string {
		return html
			.replace(/<[^>]+>/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&nbsp;/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	private parseDate(raw: string | null | undefined): Date {
		if (!raw) return new Date();
		const d = new Date(raw);
		return isNaN(d.getTime()) ? new Date() : d;
	}
}
