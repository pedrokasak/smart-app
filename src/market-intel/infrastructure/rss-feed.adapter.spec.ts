import { RssFeedAdapter } from './rss-feed.adapter';
import { MarketSource } from 'src/market-intel/domain/market-intel.types';

const SOURCE_A: MarketSource = {
	id: 'test-a',
	name: 'Test A',
	feedUrl: 'https://example.com/feed.rss',
	layer: 'A',
	enabled: true,
	domain: 'example.com',
	lastFetchedAt: null,
	etag: null,
	lastModified: null,
};

const SOURCE_B: MarketSource = { ...SOURCE_A, id: 'test-b', layer: 'B' };

const RSS_FIXTURE = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Banco Central eleva taxa Selic</title>
      <description>O Comitê de Política Monetária (Copom) decidiu elevar a taxa Selic em 0,25 ponto percentual.</description>
      <link>https://bcb.gov.br/noticias/selic-2024</link>
      <pubDate>Mon, 02 Nov 2026 10:00:00 +0000</pubDate>
      <dc:creator>BCB</dc:creator>
    </item>
    <item>
      <title>IBGE divulga IPCA</title>
      <description>Inflação de outubro ficou em 0,56%.</description>
      <link>https://ibge.gov.br/noticias/ipca-out</link>
      <pubDate>Mon, 02 Nov 2026 09:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Tesouro Direto atualiza taxas</title>
    <link href="https://tesouro.gov.br/taxas" rel="alternate"/>
    <updated>2026-11-02T08:00:00Z</updated>
    <summary>Taxas do Tesouro IPCA+ subiram 0.1 ponto.</summary>
    <author><name>Tesouro Nacional</name></author>
  </entry>
</feed>`;

describe('RssFeedAdapter', () => {
	let adapter: RssFeedAdapter;

	beforeEach(() => {
		adapter = new RssFeedAdapter();
	});

	it('parses RSS 2.0 items', () => {
		const items = (
			adapter as unknown as {
				parse: (xml: string, src: MarketSource) => unknown[];
			}
		).parse(RSS_FIXTURE, SOURCE_A);
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({
			title: 'Banco Central eleva taxa Selic',
			url: 'https://bcb.gov.br/noticias/selic-2024',
			author: 'BCB',
		});
	});

	it('parses Atom items', () => {
		const items = (
			adapter as unknown as {
				parse: (xml: string, src: MarketSource) => unknown[];
			}
		).parse(ATOM_FIXTURE, SOURCE_A);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			title: 'Tesouro Direto atualiza taxas',
			url: 'https://tesouro.gov.br/taxas',
			author: 'Tesouro Nacional',
		});
	});

	it('truncates description to 300 chars for layer B', () => {
		const longDesc = 'x'.repeat(500);
		const rss = RSS_FIXTURE.replace(
			'O Comitê de Política Monetária (Copom) decidiu elevar a taxa Selic em 0,25 ponto percentual.',
			longDesc
		);
		const items = (
			adapter as unknown as {
				parse: (xml: string, src: MarketSource) => unknown[];
			}
		).parse(rss, SOURCE_B);
		expect(
			(items[0] as { description: string }).description.length
		).toBeLessThanOrEqual(300);
	});

	it('does NOT truncate description for layer A', () => {
		const longDesc = 'x'.repeat(500);
		const rss = RSS_FIXTURE.replace(
			'O Comitê de Política Monetária (Copom) decidiu elevar a taxa Selic em 0,25 ponto percentual.',
			longDesc
		);
		const items = (
			adapter as unknown as {
				parse: (xml: string, src: MarketSource) => unknown[];
			}
		).parse(rss, SOURCE_A);
		expect((items[0] as { description: string }).description.length).toBe(500);
	});

	it('returns null items on 304', async () => {
		global.fetch = jest.fn().mockResolvedValueOnce({
			status: 304,
			ok: true,
			headers: { get: () => null },
		} as unknown as Response);

		const result = await adapter.fetch(SOURCE_A);
		expect(result.items).toBeNull();
	});
});
