import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

type FundamentusIndicatorMap = Record<string, number>;
type FundamentusTextMap = Record<string, string>;
type FundamentusSnapshot = {
	numeric: FundamentusIndicatorMap;
	text: FundamentusTextMap;
};

export type FundamentusField = { value: number | null; text: string };

export type FundamentusEntry = { label: string; value: string };

/**
 * Extracao dos pares rotulo/valor da pagina do Fundamentus.
 *
 * Vive fora da classe de proposito. Ela e passada para `page.$$eval`, que
 * serializa a funcao e a executa dentro do browser, entao ela nao pode
 * referenciar nada do escopo do modulo nem `this`. Estar no topo do arquivo,
 * exportada e pura, e tambem o que torna a extracao testavel a partir de um
 * HTML gravado, sem subir um Chromium: era exatamente o trecho que nenhum
 * teste alcancava, e por isso o rotulo real (`?ROIC`, com o marcador de ajuda
 * dentro da celula) nunca apareceu em teste nenhum.
 */
export function extractTdPairs(
	nodes: ArrayLike<{ textContent: string | null }>
): FundamentusEntry[] {
	const out: FundamentusEntry[] = [];
	for (let i = 0; i < nodes.length - 1; i++) {
		const label = (nodes[i].textContent || '').trim();
		const value = (nodes[i + 1].textContent || '').trim();
		if (!label || !value) continue;
		if (!/[:A-Za-zÀ-ÖØ-öø-ÿ]/.test(label)) continue;
		out.push({ label, value });
	}
	return out;
}

@Injectable()
export class FundamentusFallbackAdapter {
	private readonly logger = new Logger(FundamentusFallbackAdapter.name);
	private static browser: puppeteer.Browser | null = null;
	private static readonly cache = new Map<
		string,
		{ expiresAt: number; data: FundamentusSnapshot }
	>();
	private static readonly inflight = new Map<
		string,
		Promise<FundamentusSnapshot>
	>();
	private static readonly CACHE_TTL_MS = 10 * 60 * 1000;

	private parseNumber(value: unknown): number {
		if (value === null || value === undefined) return 0;
		const raw = String(value).trim();
		if (!raw || raw === '-' || raw.toLowerCase() === 'n/a') return 0;

		const normalized = raw
			.replace(/\./g, '')
			.replace('%', '')
			.replace(',', '.')
			.replace(/[^\d.-]/g, '');

		const parsed = Number(normalized);
		return Number.isFinite(parsed) ? parsed : 0;
	}

	private normalizeLabel(label: string): string {
		return label
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.toUpperCase();
	}

	/**
	 * Segundo trecho da extracao: pares crus viram o snapshot chaveado. Fica
	 * separado de `loadSnapshot` pelo mesmo motivo que `extractTdPairs`: e o
	 * que permite um teste levar um HTML gravado ate `getFields` sem browser.
	 */
	private buildSnapshot(entries: FundamentusEntry[]): FundamentusSnapshot {
		const numeric: FundamentusIndicatorMap = {};
		const text: FundamentusTextMap = {};
		for (const item of entries) {
			const key = this.normalizeLabel(item.label);
			const value = this.parseNumber(item.value);
			if (!key) continue;
			numeric[key] = value;
			text[key] = String(item.value || '').trim();
		}
		return { numeric, text };
	}

	private async getBrowser() {
		if (
			FundamentusFallbackAdapter.browser &&
			FundamentusFallbackAdapter.browser.connected
		) {
			return FundamentusFallbackAdapter.browser;
		}

		FundamentusFallbackAdapter.browser = null;
		FundamentusFallbackAdapter.browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox'],
		});
		return FundamentusFallbackAdapter.browser;
	}

	private isConnectionClosedError(error: unknown): boolean {
		const message = String(
			(error as any)?.message || error || ''
		).toLowerCase();
		return (
			message.includes('connection closed') ||
			message.includes('target closed') ||
			message.includes('session closed') ||
			message.includes('browser has disconnected')
		);
	}

	private async closeBrowserSafely() {
		const browser = FundamentusFallbackAdapter.browser;
		FundamentusFallbackAdapter.browser = null;
		if (!browser) return;
		try {
			await browser.close();
		} catch {
			// no-op
		}
	}

	private async loadSnapshot(symbol: string): Promise<FundamentusSnapshot> {
		const normalizedSymbol = symbol.toUpperCase();
		const now = Date.now();
		const cached = FundamentusFallbackAdapter.cache.get(normalizedSymbol);
		if (cached && cached.expiresAt > now) return cached.data;

		const existingRequest =
			FundamentusFallbackAdapter.inflight.get(normalizedSymbol);
		if (existingRequest) return existingRequest;

		const request = (async (): Promise<FundamentusSnapshot> => {
			for (let attempt = 1; attempt <= 2; attempt++) {
				let page: puppeteer.Page | null = null;
				try {
					const browser = await this.getBrowser();
					page = await browser.newPage();
					await page.setUserAgent(
						'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
					);
					await page.goto(
						`https://www.fundamentus.com.br/detalhes.php?papel=${encodeURIComponent(normalizedSymbol)}`,
						{
							waitUntil: 'domcontentloaded',
							timeout: 30000,
						}
					);

					const entries = await page.$$eval('td', extractTdPairs);

					const snapshot = this.buildSnapshot(entries);
					FundamentusFallbackAdapter.cache.set(normalizedSymbol, {
						expiresAt: Date.now() + FundamentusFallbackAdapter.CACHE_TTL_MS,
						data: snapshot,
					});
					return snapshot;
				} catch (error) {
					if (this.isConnectionClosedError(error) && attempt < 2) {
						this.logger.warn(
							`Conexao Puppeteer fechada para ${symbol}; reiniciando browser e tentando novamente`
						);
						await this.closeBrowserSafely();
						continue;
					}
					this.logger.warn(
						`Falha ao consultar Fundamentus para ${symbol}: ${error?.message || error}`
					);
					return { numeric: {}, text: {} };
				} finally {
					if (page) {
						await page.close().catch(() => undefined);
					}
				}
			}
			return { numeric: {}, text: {} };
		})();

		FundamentusFallbackAdapter.inflight.set(normalizedSymbol, request);
		try {
			return await request;
		} finally {
			FundamentusFallbackAdapter.inflight.delete(normalizedSymbol);
		}
	}

	async getSnapshot(symbol: string): Promise<FundamentusSnapshot> {
		return this.loadSnapshot(symbol);
	}

	async getIndicators(symbol: string): Promise<FundamentusIndicatorMap> {
		const snapshot = await this.loadSnapshot(symbol);
		return snapshot.numeric;
	}

	private parseNullableNumber(value: unknown): number | null {
		if (value === null || value === undefined) return null;
		const raw = String(value).trim();
		if (!raw || raw === '-' || raw.toLowerCase() === 'n/a') return null;
		if (!/\d/.test(raw)) return null;

		const normalized = raw
			.replace(/\./g, '')
			.replace('%', '')
			.replace(',', '.')
			.replace(/[^\d.-]/g, '');

		const parsed = Number(normalized);
		return Number.isFinite(parsed) ? parsed : null;
	}

	async getFields(symbol: string): Promise<Record<string, FundamentusField>> {
		const snapshot = await this.loadSnapshot(symbol);
		const fields: Record<string, FundamentusField> = {};
		for (const [key, text] of Object.entries(snapshot.text)) {
			fields[key] = { value: this.parseNullableNumber(text), text };
		}
		return fields;
	}
}
