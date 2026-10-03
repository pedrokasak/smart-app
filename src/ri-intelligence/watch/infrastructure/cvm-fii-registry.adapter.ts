import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { readZipEntry } from 'src/common/zip/read-zip-entry';
import { issuerBaseCode } from 'src/ri-intelligence/domain/issuer-base-code';
import { FiiFundDirectory } from 'src/ri-intelligence/watch/application/ports/fii-fund-directory.port';
import { parseFiiRegistry } from './cvm-fii-registry.parser';

/**
 * Ticker de FII -> CNPJ do fundo (TRA-266), pelo informe mensal de FII dos
 * dados abertos da CVM (`dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL`): o CSV
 * geral liga o CNPJ ao ISIN da cota, e o ISIN carrega o codigo do ticker.
 * A API de fundos listados da B3 (`fundsProxy`) passou a responder vazia
 * (conferido em 03/10/2026).
 *
 * Le o ano corrente e o anterior: em janeiro o arquivo do ano novo ainda
 * esta vazio, e um fundo que parou de entregar o informe continua
 * resolvendo. Cache de 24h, como o registro da B3 das companhias; falha nao
 * e guardada, e a rodada seguinte tenta de novo.
 */
@Injectable()
export class CvmFiiRegistryAdapter implements FiiFundDirectory {
	private readonly logger = new Logger(CvmFiiRegistryAdapter.name);
	static readonly BASE_URL =
		'https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS';
	private static readonly TTL_MS = 24 * 60 * 60 * 1000;
	private static readonly TIMEOUT_MS = 60_000;
	private static readonly MAX_BYTES = 30 * 1024 * 1024;

	private cache: { expiresAt: number; byCode: Map<string, string> } | null =
		null;
	private inflight: Promise<Map<string, string>> | null = null;

	constructor(private readonly httpService: HttpService) {}

	async resolveFundCnpj(ticker: string): Promise<string | null> {
		const code = issuerBaseCode(ticker);
		if (!code) return null;
		const registry = await this.registry();
		return registry.get(code) ?? null;
	}

	private async registry(): Promise<Map<string, string>> {
		if (this.cache && this.cache.expiresAt > Date.now()) {
			return this.cache.byCode;
		}
		if (!this.inflight) {
			this.inflight = this.load().finally(() => {
				this.inflight = null;
			});
		}
		return this.inflight;
	}

	private async load(): Promise<Map<string, string>> {
		const year = new Date().getUTCFullYear();
		const byCode = new Map<string, string>();
		// Ano anterior primeiro: o corrente, lido depois, prevalece.
		for (const target of [year - 1, year]) {
			try {
				for (const [code, cnpj] of await this.loadYear(target)) {
					byCode.set(code, cnpj);
				}
			} catch (err) {
				this.logger.warn(
					`Informe mensal de FII ${target} indisponivel: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}
		if (!byCode.size) {
			throw new Error('cvm_fii_registry_unavailable');
		}
		this.cache = {
			expiresAt: Date.now() + CvmFiiRegistryAdapter.TTL_MS,
			byCode,
		};
		return byCode;
	}

	private async loadYear(year: number): Promise<Map<string, string>> {
		const response = await firstValueFrom(
			this.httpService.get<ArrayBuffer>(
				`${CvmFiiRegistryAdapter.BASE_URL}/inf_mensal_fii_${year}.zip`,
				{
					responseType: 'arraybuffer',
					timeout: CvmFiiRegistryAdapter.TIMEOUT_MS,
					maxContentLength: CvmFiiRegistryAdapter.MAX_BYTES,
				}
			)
		);
		const csv = await this.extractCsv(Buffer.from(response.data), year);
		return parseFiiRegistry(csv);
	}

	/**
	 * CSV geral de dentro do zip, em ISO-8859-1 como todo dado aberto da CVM.
	 * `protected`: o teste troca o unzip sem montar um zip real.
	 */
	protected async extractCsv(buffer: Buffer, year: number): Promise<string> {
		const csv = await readZipEntry(buffer, `inf_mensal_fii_geral_${year}.csv`);
		return csv ? csv.toString('latin1') : '';
	}
}
