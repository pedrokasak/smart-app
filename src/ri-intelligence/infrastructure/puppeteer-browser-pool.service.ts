import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser, Page } from 'puppeteer';
import puppeteer from 'puppeteer';

/**
 * Pool singleton de browser Puppeteer: mantém UM Chromium reutilizável para
 * todas as descobertas RI concorrentes (HTTP não-FII → CVM → Puppeteer),
 * evitando o custo de `puppeteer.launch()` por chamada (500-2000ms cada).
 *
 * Cada `withPage()` abre um `newPage()` barato, executa o callback e fecha a
 * página no finally (não fecha o browser). Recuperação de crash: se o browser
 * disconnecta (cidadão do OS o matou, OOM, etc.), o handler `disconnected`
 * anula a referência e a próxima `withPage()` recria o browser
 * transparentemente. Em `OnModuleDestroy` fecha o browser gracioso.
 */
@Injectable()
export class PuppeteerBrowserPool implements OnModuleDestroy {
	private readonly logger = new Logger(PuppeteerBrowserPool.name);
	private browser: Browser | null = null;
	/** Guarda um relançamento em andamento para não lançar dois Chromiums. */
	private relaunchInflight: Promise<Browser> | null = null;

	private readonly launchArgs = [
		'--no-sandbox',
		'--disable-setuid-sandbox',
		'--disable-dev-shm-usage',
	];

	private async ensureBrowser(): Promise<Browser> {
		// Reutiliza o browser ativo se ainda conectado.
		if (this.browser && this.browser.connected) {
			return this.browser;
		}
		// Se um relançamento já está em curso, espera o mesmo (evita double-launch).
		if (this.relaunchInflight) {
			return this.relaunchInflight;
		}
		this.relaunchInflight = (async () => {
			try {
				const launched = await puppeteer.launch({
					headless: true,
					args: this.launchArgs,
				});
				// Anula a ref quando o browser morrer (outro processo, OOM, ...).
				launched.on('disconnected', () => {
					this.logger.warn('Browser disconnected; will relaunch on next use.');
					if (this.browser === launched) this.browser = null;
				});
				this.browser = launched;
				this.logger.log('Launched a shared headless browser.');
				return launched;
			} catch (error) {
				this.logger.error(
					`Failed to launch browser: ${error?.message || error}`
				);
				throw error;
			} finally {
				this.relaunchInflight = null;
			}
		})();
		return this.relaunchInflight;
	}

	/**
	 * Executa `fn` numa `Page` fresca do browser compartilhado e sempre fecha
	 * a página ao fim (sucesso ou erro). O browser permanece aberto para a
	 * próxima chamada.
	 */
	async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
		const browser = await this.ensureBrowser();
		const page = await browser.newPage();
		await page.setUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
		);
		try {
			return await fn(page);
		} finally {
			try {
				await page.close();
			} catch {
				// page já pode estar fechada/fechando — ignora.
			}
		}
	}

	async onModuleDestroy(): Promise<void> {
		const current = this.browser;
		this.browser = null;
		if (!current) return;
		try {
			await current.close();
			this.logger.log('Closed shared headless browser on module destroy.');
		} catch {
			// já fechado — ignora.
		}
	}
}
