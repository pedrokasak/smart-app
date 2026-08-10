import { Injectable, Logger } from '@nestjs/common';
import {
	RiIssuerCatalogPort,
	RiIssuerRef,
} from 'src/ri-intelligence/application/ri-issuer-catalog.port';
import { B3RegistryCnpjResolverAdapter } from 'src/ri-intelligence/infrastructure/b3-registry-cnpj-resolver.adapter';
import { StockService } from 'src/stocks/stocks.service';

/**
 * Resolve ticker → CNPJ via cotação individual da Brapi exposta pelo
 * `StockService.getNationalQuote`. O CNPJ vem em `response.results[0].cnpj`
 * no formato `00.000.000/0000-00`; normalizamos para só dígitos (mesma regra
 * do `CvmOpenDataAdapter.normalizeCnpj`), que é como a CVM indexa as linhas
 * (coluna `CNPJ_Companhia`).
 *
 * Cache em memória (TTL curto) + dedup de in-flight: várias descobertas
 * concorrentes para o mesmo ticker compartilham a mesma resolução, e o
 * decaimento evita reusar um CNPJ desatualizado indefinidamente.
 */
@Injectable()
export class StocksRiIssuerCatalogAdapter implements RiIssuerCatalogPort {
	private readonly logger = new Logger(StocksRiIssuerCatalogAdapter.name);
	private readonly cache = new Map<
		string,
		{ expiresAt: number; ref: RiIssuerRef | null }
	>();
	private readonly inflight = new Map<string, Promise<RiIssuerRef | null>>();
	private readonly ttlMs = 6 * 60 * 60 * 1000;

	constructor(
		private readonly stockService: StockService,
		private readonly b3Registry: B3RegistryCnpjResolverAdapter
	) {}

	async resolveByTicker(ticker: string): Promise<RiIssuerRef | null> {
		const normalizedTicker = String(ticker || '')
			.trim()
			.toUpperCase()
			.replace(/\.SA$/i, '');
		if (!normalizedTicker) return null;

		const now = Date.now();
		const cached = this.cache.get(normalizedTicker);
		if (cached && cached.expiresAt > now) return cached.ref;

		const inflight = this.inflight.get(normalizedTicker);
		if (inflight) return inflight;

		const request = (async () => {
			try {
				const response: any = await this.stockService.getNationalQuote(
					normalizedTicker,
					{ fundamental: true }
				);
				const stock = response?.results?.[0];
				let cnpj = this.normalizeCnpj(stock?.cnpj);
				let company: string =
					stock?.longName || stock?.shortName || normalizedTicker;

				if (!cnpj) {
					try {
						const registryMatch = await this.b3Registry.resolveCnpj(
							normalizedTicker
						);
						if (registryMatch) {
							cnpj = registryMatch.cnpj;
							company = registryMatch.company || company;
						}
					} catch (error) {
						this.logger.warn(
							`Falha ao consultar registro B3 para ${normalizedTicker}: ${error?.message || error}`
						);
					}
				}

				if (!cnpj) {
					this.logger.debug(
						`Sem CNPJ na cotação nem no registro B3 de ${normalizedTicker}; descoberta CVM indisponível`
					);
					this.cache.set(normalizedTicker, {
						expiresAt: Date.now() + this.ttlMs,
						ref: null,
					});
					return null;
				}

				const ref: RiIssuerRef = {
					ticker: normalizedTicker,
					company,
					cnpj,
				};
				this.cache.set(normalizedTicker, {
					expiresAt: Date.now() + this.ttlMs,
					ref,
				});
				return ref;
			} catch (error) {
				this.logger.warn(
					`Falha ao resolver CNPJ para ${normalizedTicker}: ${error?.message || error}`
				);
				return null;
			}
		})();

		this.inflight.set(normalizedTicker, request);
		try {
			return await request;
		} finally {
			this.inflight.delete(normalizedTicker);
		}
	}

	private normalizeCnpj(cnpj?: string): string {
		return String(cnpj || '').replace(/[^\d]/g, '');
	}
}
