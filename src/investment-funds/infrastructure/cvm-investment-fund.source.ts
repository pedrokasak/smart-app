import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { streamZipEntryLines } from 'src/common/zip/stream-zip-entry';
import type {
	DailyReport,
	InvestmentFundDataSource,
	SourceRead,
} from '../application/ports/investment-funds.ports';
import type { InvestmentFundClass } from '../domain/fund-class';
import { parseFundRegistry } from './fund-registry.parser';
import { LatestFundQuoteAccumulator } from './informe-diario.parser';

export const CVM_BASE_URL = 'https://dados.cvm.gov.br/dados/FI';

/**
 * Tetos medidos em 08/10/2026 com folga de ~4×: o Informe Diário de 09/2026
 * tem 11,6 MB zipado e 54 MB descomprimido; o registro, 6,8 MB zipado e
 * 16 MB no CSV de classes.
 */
export const LIMITS = {
	dailyZipBytes: 60 * 1024 * 1024,
	dailyCsvBytes: 256 * 1024 * 1024,
	registryZipBytes: 40 * 1024 * 1024,
	registryCsvBytes: 128 * 1024 * 1024,
} as const;

const DOWNLOAD_TIMEOUT_MS = 120_000;

export class CvmDownloadTooLargeError extends Error {
	constructor(url: string, maxBytes: number) {
		super(`${url} passou de ${maxBytes} bytes`);
		this.name = 'CvmDownloadTooLargeError';
	}
}

/**
 * Dados abertos de fundos da CVM (`dados.cvm.gov.br`, TRA-276). O endereço é
 * montado aqui, só com a competência: nenhuma URL vem de fora.
 */
@Injectable()
export class CvmInvestmentFundSource implements InvestmentFundDataSource {
	/** Substituível nos testes. */
	fetchImpl: typeof fetch = (input, init) => fetch(input, init);

	async fetchDailyReport(
		competence: string,
		knownSha256?: string | null
	): Promise<SourceRead<DailyReport>> {
		if (!/^\d{6}$/.test(competence)) {
			throw new Error(`Competência inválida: ${competence}`);
		}
		const sourceUrl = `${CVM_BASE_URL}/DOC/INF_DIARIO/DADOS/inf_diario_fi_${competence}.zip`;
		const download = await this.download(sourceUrl, LIMITS.dailyZipBytes);
		if (!download) return { status: 'missing', sourceUrl };
		if (download.sha256 === knownSha256) {
			return { status: 'unchanged', sourceUrl, sha256: download.sha256 };
		}

		const accumulator = new LatestFundQuoteAccumulator();
		const entry = `inf_diario_fi_${competence}.csv`;
		const found = await streamZipEntryLines(
			download.buffer,
			entry,
			LIMITS.dailyCsvBytes,
			(line) => accumulator.pushLine(line)
		);
		if (!found) throw new Error(`${entry} não está no zip da CVM`);

		return {
			status: 'parsed',
			sourceUrl,
			sha256: download.sha256,
			data: accumulator.result(),
		};
	}

	async fetchRegistry(
		knownSha256?: string | null
	): Promise<SourceRead<InvestmentFundClass[]>> {
		const sourceUrl = `${CVM_BASE_URL}/CAD/DADOS/registro_fundo_classe.zip`;
		const download = await this.download(sourceUrl, LIMITS.registryZipBytes);
		if (!download) return { status: 'missing', sourceUrl };
		if (download.sha256 === knownSha256) {
			return { status: 'unchanged', sourceUrl, sha256: download.sha256 };
		}

		const classes = await this.readText(download.buffer, 'registro_classe.csv');
		if (classes === null) {
			throw new Error('registro_classe.csv não está no zip da CVM');
		}
		const subclasses = await this.readText(
			download.buffer,
			'registro_subclasse.csv'
		);
		return {
			status: 'parsed',
			sourceUrl,
			sha256: download.sha256,
			data: parseFundRegistry({ classes, subclasses }),
		};
	}

	private async readText(
		buffer: Buffer,
		fileName: string
	): Promise<string | null> {
		const lines: string[] = [];
		const found = await streamZipEntryLines(
			buffer,
			fileName,
			LIMITS.registryCsvBytes,
			(line) => lines.push(line)
		);
		return found ? lines.join('\n') : null;
	}

	/** Baixa inteiro (até o teto) e devolve com o hash; 404 vira `null`. */
	private async download(
		url: string,
		maxBytes: number
	): Promise<{ buffer: Buffer; sha256: string } | null> {
		const response = await this.fetchImpl(url, {
			signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		});
		if (response.status === 404) return null;
		if (!response.ok || !response.body) {
			throw new Error(`CVM respondeu HTTP ${response.status} para ${url}`);
		}
		const declared = Number(response.headers.get('content-length'));
		if (Number.isFinite(declared) && declared > maxBytes) {
			throw new CvmDownloadTooLargeError(url, maxBytes);
		}

		const reader = response.body.getReader();
		const chunks: Buffer[] = [];
		let total = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new CvmDownloadTooLargeError(url, maxBytes);
			}
			chunks.push(Buffer.from(value));
		}
		const buffer = Buffer.concat(chunks);
		return {
			buffer,
			sha256: createHash('sha256').update(buffer).digest('hex'),
		};
	}
}
