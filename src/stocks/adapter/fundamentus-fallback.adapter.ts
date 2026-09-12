import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

type FundamentusIndicatorMap = Record<string, number>;
type FundamentusTextMap = Record<string, string>;
type FundamentusSnapshot = {
	numeric: FundamentusIndicatorMap;
	text: FundamentusTextMap;
};

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

					const entries = await page.$$eval('td', (nodes) => {
						const out: Array<{ label: string; value: string }> = [];
						for (let i = 0; i < nodes.length - 1; i++) {
							const label = (nodes[i].textContent || '').trim();
							const value = (nodes[i + 1].textContent || '').trim();
							if (!label || !value) continue;
							if (!/[:A-Za-zÀ-ÖØ-öø-ÿ]/.test(label)) continue;
							out.push({ label, value });
						}
						return out;
					});

					const numeric: FundamentusIndicatorMap = {};
					const text: FundamentusTextMap = {};
					for (const item of entries) {
						const key = this.normalizeLabel(item.label);
						const value = this.parseNumber(item.value);
						if (!key) continue;
						numeric[key] = value;
						text[key] = String(item.value || '').trim();
					}

					const snapshot: FundamentusSnapshot = { numeric, text };
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
}
