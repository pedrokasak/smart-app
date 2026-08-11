import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

interface RegistryEntry {
	cnpj: string;
	company: string;
}

interface B3CompanyRow {
	issuingCompany?: string;
	companyName?: string;
	cnpj?: string;
}

interface B3GetInitialCompaniesResponse {
	page?: {
		pageNumber?: number;
		pageSize?: number;
		totalRecords?: number | null;
		totalPages?: number | null;
	};
	results?: B3CompanyRow[];
}

/**
 * Segunda fonte de CNPJ, usada como fallback quando a cotação da Brapi
 * (`StocksRiIssuerCatalogAdapter`) não traz o campo `cnpj`.
 *
 * Consulta o endpoint público (sem API key) usado pela própria página
 * "Empresas Listadas" da B3:
 *
 *   GET https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetInitialCompanies/<base64({language,pageNumber,pageSize})>
 *
 * Verificado ao vivo em 2026-08-10: retorna
 * `{ page: { pageNumber, pageSize, totalRecords, totalPages }, results: [{ codeCVM, issuingCompany, companyName, tradingName, cnpj, ... }] }`.
 * `pageSize` acima de ~120 é rejeitado silenciosamente pelo servidor
 * (responde 200 com `results: []` e `page.totalRecords: null`), então
 * paginamos em blocos de 120.
 *
 * Importante: `issuingCompany` é o código-base do emissor (ex.: "PETR"),
 * SEM o dígito de espécie do ticker (ex.: "PETR4" tem espécie "4"). Por
 * isso o matching de ticker → registro é feito removendo os dígitos finais
 * do ticker. Além disso, o `cnpj` retornado pela B3 vem sem zeros à
 * esquerda (ex.: "3987364000103" em vez de "03987364000103"), então
 * normalizamos preenchendo até 14 dígitos.
 */
@Injectable()
export class B3RegistryCnpjResolverAdapter {
	private readonly logger = new Logger(B3RegistryCnpjResolverAdapter.name);
	private readonly registryBaseUrl =
		'https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetInitialCompanies';
	private readonly pageSize = 120;
	// Limite de segurança para não entrar em loop indefinido caso a API
	// retorne um totalPages absurdo; hoje (2026-08-10) a B3 lista ~3500
	// companhias, ou seja, ~30 páginas de 120.
	private readonly maxPages = 60;

	private cache: {
		expiresAt: number;
		byTicker: Map<string, RegistryEntry>;
	} | null = null;
	private inflight: Promise<Map<string, RegistryEntry>> | null = null;
	private readonly ttlMs = 24 * 60 * 60 * 1000;

	constructor(private readonly httpService: HttpService) {}

	private normalizeCnpj(cnpj?: string): string {
		const digits = String(cnpj || '').replace(/[^\d]/g, '');
		// A B3 usa "0" como placeholder de CNPJ para instrumentos sem CNPJ
		// próprio (ex.: alguns ETPs/BDRs de cripto) — não é um CNPJ real.
		if (!digits || /^0+$/.test(digits)) return '';
		return digits.padStart(14, '0');
	}

	/** Remove o(s) dígito(s) de espécie no final do ticker (ex.: PETR4 → PETR). */
	private baseCode(ticker: string): string {
		return String(ticker || '')
			.trim()
			.toUpperCase()
			.replace(/\d+$/, '');
	}

	private buildPageUrl(pageNumber: number): string {
		const params = { language: 'pt-br', pageNumber, pageSize: this.pageSize };
		const encoded = Buffer.from(JSON.stringify(params)).toString('base64');
		return `${this.registryBaseUrl}/${encoded}`;
	}

	private async fetchPage(
		pageNumber: number
	): Promise<B3GetInitialCompaniesResponse> {
		const response = await firstValueFrom(
			this.httpService.get<B3GetInitialCompaniesResponse>(
				this.buildPageUrl(pageNumber),
				{ timeout: 15000 }
			)
		);
		return response.data;
	}

	private async loadRegistry(): Promise<Map<string, RegistryEntry>> {
		const now = Date.now();
		if (this.cache && this.cache.expiresAt > now) return this.cache.byTicker;
		if (this.inflight) return this.inflight;

		this.inflight = (async () => {
			try {
				const byBaseCode = new Map<string, RegistryEntry>();
				const first = await this.fetchPage(1);
				this.mergeRows(byBaseCode, first.results);

				const totalPages = Math.min(first.page?.totalPages || 1, this.maxPages);
				for (let page = 2; page <= totalPages; page++) {
					const next = await this.fetchPage(page);
					this.mergeRows(byBaseCode, next.results);
				}

				this.cache = {
					expiresAt: Date.now() + this.ttlMs,
					byTicker: byBaseCode,
				};
				return byBaseCode;
			} catch (error) {
				this.logger.warn(
					`Falha ao carregar registro B3 de companhias: ${error?.message || error}`
				);
				// Se já existe um registro carregado com sucesso anteriormente
				// (mesmo expirado), preferimos servi-lo a falhar — é dado real,
				// só potencialmente desatualizado. Só propagamos o erro quando
				// NUNCA houve um carregamento bem-sucedido, para que o chamador
				// (StocksRiIssuerCatalogAdapter) possa distinguir "não encontrado
				// num registro carregado" de "registro indisponível agora" e
				// evitar poluir o cache negativo de 6h com uma falha transitória.
				if (this.cache?.byTicker) return this.cache.byTicker;
				throw error;
			} finally {
				this.inflight = null;
			}
		})();

		return this.inflight;
	}

	private mergeRows(
		target: Map<string, RegistryEntry>,
		rows?: B3CompanyRow[]
	): void {
		for (const row of rows || []) {
			const baseCode = String(row?.issuingCompany || '')
				.trim()
				.toUpperCase();
			const cnpj = this.normalizeCnpj(row?.cnpj);
			const company = String(row?.companyName || '').trim();
			if (!baseCode || !cnpj || !company) continue;
			target.set(baseCode, { cnpj, company });
		}
	}

	async resolveCnpj(
		ticker: string
	): Promise<{ cnpj: string; company: string } | null> {
		const normalizedTicker = String(ticker || '')
			.trim()
			.toUpperCase();
		if (!normalizedTicker) return null;
		const registry = await this.loadRegistry();
		const entry = registry.get(this.baseCode(normalizedTicker));
		if (!entry) return null;
		return { cnpj: entry.cnpj, company: entry.company };
	}
}
