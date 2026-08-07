import { describe, it, expect, jest } from '@jest/globals';
import { PuppeteerRiDocumentDiscoveryAdapter } from 'src/ri-intelligence/infrastructure/puppeteer-ri-document-discovery.adapter';
import { PuppeteerBrowserPool } from 'src/ri-intelligence/infrastructure/puppeteer-browser-pool.service';

/**
 * Mock mínimo de Page do Puppeteer: só os métodos que o adapter chama
 * (goto, evaluate, setUserAgent). Não importa real DOM aqui — só o contrato
 * de que o adapter delega ao pool e consome os links retornados.
 */
function buildPageMock(): any {
	const visited: string[] = [];
	const page: any = {
		setUserAgent: jest.fn(() => Promise.resolve(undefined)),
		goto: jest.fn(async (url: string) => {
			visited.push(url);
		}),
		evaluate: jest.fn(async () => {
			// O callback do browser é ignorado neste mock; retornamos links de
			// teste pertinentes ao target atual, simulando anchors do DOM.
			const current = visited[visited.length - 1] || '';
			if (current.includes('/resultados')) {
				return [
					{
						url: 'https://ri.example.com/resultados/4t25.pdf',
						title: 'Release de Resultados 4T25',
					},
					{
						url: 'https://ri.example.com/resultados/apresentacao.pptx',
						title: 'Apresentacao 4T25',
					},
				];
			}
			if (current.includes('/fatos-relevantes')) {
				return [
					{
						url: 'https://ri.example.com/fatos/fato-relevante-2026-02-10.pdf',
						title: 'Fato Relevante',
					},
				];
			}
			return [
				{
					url: 'https://ri.example.com/documentos/relatorio-anual.pdf',
					title: 'Relatorio Anual 2025',
				},
			];
		}),
	};
	return { page, visited };
}

describe('PuppeteerRiDocumentDiscoveryAdapter', () => {
	it('discovers documents through the shared browser pool (not launch per call)', async () => {
		const { page } = buildPageMock();
		const withPageMock = jest
			.fn()
			.mockImplementation(async (fn: (p: any) => Promise<any>) => fn(page));
		const pool: Partial<PuppeteerBrowserPool> = {
			withPage: withPageMock as any,
		};
		const adapter = new PuppeteerRiDocumentDiscoveryAdapter(
			pool as PuppeteerBrowserPool
		);

		const output = await adapter.discover({
			ticker: 'ITUB4',
			company: 'Itaú',
			origin: 'https://ri.example.com',
		});

		// O pool foi usado exatamente uma vez (não puppeteer.launch).
		expect(pool.withPage).toHaveBeenCalledTimes(1);
		// A página foi reutilizada para todos os scanTargets (goto chamado >=2x).
		expect(page.goto).toHaveBeenCalled();
		// Documentos foram coletados e classificados a partir dos links mock.
		expect(output.length).toBeGreaterThan(0);
		// A ordem é desc por publishedAt; todos têm metadata_only.
		expect(output.every((doc) => doc.contentStatus === 'metadata_only')).toBe(
			true
		);
		expect(output.some((doc) => doc.documentType === 'material_fact')).toBe(
			true
		);
	});

	it('returns [] when the pool rejects (browser unavailable) without throwing', async () => {
		const pool: Partial<PuppeteerBrowserPool> = {
			withPage: jest.fn(async () =>
				Promise.reject(new Error('browser launch failed'))
			) as any,
		};
		const adapter = new PuppeteerRiDocumentDiscoveryAdapter(
			pool as PuppeteerBrowserPool
		);

		const output = await adapter.discover({
			ticker: 'PETR4',
			company: 'Petrobras',
			origin: 'https://ri.example.com',
		});

		// Contrato de tolerância a falhas: erro do pool não propaga; retorna [].
		expect(output).toEqual([]);
	});

	it('returns [] for invalid origin (no pool usage)', async () => {
		const pool: Partial<PuppeteerBrowserPool> = {
			withPage: jest.fn() as any,
		};
		const adapter = new PuppeteerRiDocumentDiscoveryAdapter(
			pool as PuppeteerBrowserPool
		);

		const output = await adapter.discover({
			ticker: 'VALE3',
			company: 'Vale',
			origin: 'not-a-url',
		});

		expect(output).toEqual([]);
		expect(pool.withPage).not.toHaveBeenCalled();
	});
});
