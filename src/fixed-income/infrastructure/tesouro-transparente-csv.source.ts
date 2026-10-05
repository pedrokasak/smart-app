import { Injectable, Logger } from '@nestjs/common';
import type {
	TesouroOffersSnapshot,
	TesouroOffersSource,
} from '../application/ports/tesouro-offers.ports';
import { LatestTesouroAccumulator } from './tesouro-csv-parser';

const CKAN_PACKAGE_URL =
	'https://www.tesourotransparente.gov.br/ckan/api/3/action/package_show?id=taxas-dos-titulos-ofertados-pelo-tesouro-direto';

/**
 * Endereço do arquivo na última conferência. Só vale se o catálogo (CKAN)
 * estiver fora do ar: o endereço certo é sempre o que o catálogo informa.
 */
const FALLBACK_CSV_URL =
	'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/precotaxatesourodireto.csv';

const TRUSTED_HOST = 'tesourotransparente.gov.br';
const CATALOG_TIMEOUT_MS = 15_000;
/** O arquivo tem ~15 MB; o teto cobre a leitura inteira, não só o cabeçalho. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

function isTrustedCsvUrl(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === 'https:' &&
			(url.hostname === TRUSTED_HOST ||
				url.hostname.endsWith(`.${TRUSTED_HOST}`))
		);
	} catch {
		return false;
	}
}

/**
 * Lê as taxas do Tesouro Direto no Tesouro Transparente (dado aberto do
 * governo): o CSV "Taxas dos Títulos Ofertados" traz, por pregão, a taxa e o
 * preço de cada título. Nada vem de scraping nem de API paga.
 */
@Injectable()
export class TesouroTransparenteCsvSource implements TesouroOffersSource {
	private readonly logger = new Logger(TesouroTransparenteCsvSource.name);

	/** Substituível nos testes. */
	fetchImpl: typeof fetch = (input, init) => fetch(input, init);

	async fetchLatest(): Promise<TesouroOffersSnapshot> {
		const sourceUrl = await this.resolveCsvUrl();
		const response = await this.fetchImpl(sourceUrl, {
			signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		});
		if (!response.ok || !response.body) {
			throw new Error(`Tesouro Transparente respondeu HTTP ${response.status}`);
		}

		const accumulator = new LatestTesouroAccumulator();
		await this.readLines(response.body, (line) => accumulator.pushLine(line));

		const latest = accumulator.result();
		if (!latest) {
			throw new Error('CSV do Tesouro sem nenhum título suportado.');
		}
		return { ...latest, sourceUrl };
	}

	/** Pergunta ao catálogo onde o CSV está hoje; sem resposta, usa o último conhecido. */
	private async resolveCsvUrl(): Promise<string> {
		try {
			const response = await this.fetchImpl(CKAN_PACKAGE_URL, {
				signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const body = (await response.json()) as {
				result?: { resources?: Array<{ format?: string; url?: string }> };
			};
			const csv = body.result?.resources?.find(
				(resource) => String(resource.format).toUpperCase() === 'CSV'
			);
			if (isTrustedCsvUrl(csv?.url)) return csv.url;
			throw new Error('catálogo sem CSV em endereço confiável');
		} catch (error) {
			this.logger.warn(
				`Catálogo do Tesouro Transparente indisponível (${error instanceof Error ? error.message : error}); usando o endereço conhecido.`
			);
			return FALLBACK_CSV_URL;
		}
	}

	private async readLines(
		body: ReadableStream<Uint8Array>,
		onLine: (line: string) => void
	): Promise<void> {
		const reader = body.getReader();
		const decoder = new TextDecoder('utf-8');
		let pending = '';

		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			pending += decoder.decode(value, { stream: true });
			const lines = pending.split('\n');
			pending = lines.pop() ?? '';
			for (const line of lines) onLine(line);
		}
		pending += decoder.decode();
		if (pending) onLine(pending);
	}
}
