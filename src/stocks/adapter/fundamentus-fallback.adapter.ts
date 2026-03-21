import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

type FundamentusIndicatorMap = Record<string, number>;

@Injectable()
export class FundamentusFallbackAdapter {
	private readonly logger = new Logger(FundamentusFallbackAdapter.name);
	private static browser: puppeteer.Browser | null = null;
	private static readonly cache = new Map<
		string,
		{ expiresAt: number; data: FundamentusIndicatorMap }
	>();
	private static readonly inflight = new Map<
		string,
		Promise<FundamentusIndicatorMap>
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
		if (FundamentusFallbackAdapter.browser) {
			return FundamentusFallbackAdapter.browser;
		}

		FundamentusFallbackAdapter.browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox'],
		});
		return FundamentusFallbackAdapter.browser;
	}

	async getIndicators(symbol: string): Promise<FundamentusIndicatorMap> {
		const normalizedSymbol = symbol.toUpperCase();
		const now = Date.now();
		const cached = FundamentusFallbackAdapter.cache.get(normalizedSymbol);
		if (cached && cached.expiresAt > now) return cached.data;

		const existingRequest =
			FundamentusFallbackAdapter.inflight.get(normalizedSymbol);
		if (existingRequest) return existingRequest;

		const request = (async () => {
			const browser = await this.getBrowser();
			const page = await browser.newPage();
			try {
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

				const data: FundamentusIndicatorMap = {};
				for (const item of entries) {
					const key = this.normalizeLabel(item.label);
					const value = this.parseNumber(item.value);
					if (!key) continue;
					data[key] = value;
				}

				FundamentusFallbackAdapter.cache.set(normalizedSymbol, {
					expiresAt: Date.now() + FundamentusFallbackAdapter.CACHE_TTL_MS,
					data,
				});
				return data;
			} catch (error) {
				this.logger.warn(
					`Falha ao consultar Fundamentus para ${symbol}: ${error?.message || error}`
				);
				return {};
			} finally {
				await page.close();
			}
		})();

		FundamentusFallbackAdapter.inflight.set(normalizedSymbol, request);
		try {
			return await request;
		} finally {
			FundamentusFallbackAdapter.inflight.delete(normalizedSymbol);
		}
	}
}
