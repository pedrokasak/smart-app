import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
	ConsentStatus,
	ProfileOrigin,
	RelationshipStatus,
} from '../domain/enums';
import {
	ADVISOR_BENCHMARK_SERIES,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_CONSENT_STORE,
	ADVISOR_PRICE_HISTORY,
	ADVISOR_RELATIONSHIP_STORE,
} from './advisor.tokens';
import { AccessContext, AuthorizationService } from './authorization.service';
import {
	buildPortfolioMetrics,
	ClientPortfolioMetrics,
	measuredWindow,
} from './metrics/build-portfolio-metrics';
import { MarketInputsLoader } from './metrics/market-inputs.loader';
import type { BenchmarkSeriesPort } from './ports/benchmark-series.port';
import type { ClientProfileStorePort } from './ports/client-profile.store.port';
import type { ConsentStorePort } from './ports/consent.store.port';
import type { PriceHistoryPort } from './ports/price-history.port';
import type { RelationshipStorePort } from './ports/relationship.store.port';
import { ADVISOR_SHARED_PORTFOLIO_SOURCE } from './ports/shared-portfolio-source.port';
import type {
	OwnedPortfolio,
	SharedPortfolioData,
	SharedPortfolioSourcePort,
} from './ports/shared-portfolio-source.port';
import { reconcileSharedPortfolio } from './shared-portfolio.mapper';

export class NoActiveConsentError extends ForbiddenException {
	constructor() {
		super('No active consent for this client');
	}
}

export interface SharedPortfolioMetrics {
	portfolioId: string;
	name: string;
	metrics: ClientPortfolioMetrics;
	unreconciledSymbols: string[];
}

/** Resultado do caminho de sistema: `metrics: null` quando a carteira falhou. */
export interface SharedPortfolioSystemMetrics {
	portfolioId: string;
	metrics: ClientPortfolioMetrics | null;
	unavailableReason?: string;
}

export const SHARED_METRICS_FAILED = 'METRICS_FAILED';

/** Janela para achar o último fechamento de um ativo sem histórico. */
const LAST_CLOSE_LOOKBACK_DAYS = 30;

const daysBefore = (iso: string, days: number): string => {
	const date = new Date(`${iso}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() - days);
	return date.toISOString().slice(0, 10);
};

/**
 * Leitura, pelo assessor, das carteiras B2C que o cliente compartilhou. O
 * consentimento é relido a cada chamada: revogar ou mudar o escopo vale na
 * chamada seguinte. Nada aqui grava no B2C, e as transações sintéticas da
 * conciliação nunca são persistidas.
 */
@Injectable()
export class SharedPortfolioService {
	private readonly market: MarketInputsLoader;

	constructor(
		private readonly authorization: AuthorizationService,
		@Inject(ADVISOR_RELATIONSHIP_STORE)
		private readonly relationships: RelationshipStorePort,
		@Inject(ADVISOR_CONSENT_STORE) private readonly consents: ConsentStorePort,
		@Inject(ADVISOR_CLIENT_PROFILE_STORE)
		private readonly profiles: ClientProfileStorePort,
		@Inject(ADVISOR_SHARED_PORTFOLIO_SOURCE)
		private readonly source: SharedPortfolioSourcePort,
		@Inject(ADVISOR_PRICE_HISTORY) prices: PriceHistoryPort,
		@Inject(ADVISOR_BENCHMARK_SERIES) benchmarks: BenchmarkSeriesPort
	) {
		this.market = new MarketInputsLoader(prices, benchmarks);
	}

	async listSharedPortfolios(
		ctx: AccessContext,
		clientProfileId: string
	): Promise<OwnedPortfolio[]> {
		const { ownerUserId, portfolioIds } = await this.activeShare(
			ctx,
			clientProfileId
		);
		const owned = await this.source.listOwned(ownerUserId);
		const shared = new Set(portfolioIds);
		return owned.filter((p) => shared.has(p.id));
	}

	async getSharedMetrics(
		ctx: AccessContext,
		clientProfileId: string
	): Promise<SharedPortfolioMetrics[]> {
		const { ownerUserId, portfolioIds } = await this.activeShare(
			ctx,
			clientProfileId
		);
		const data = await this.source.read(ownerUserId, portfolioIds);
		const byId = new Map(data.map((p) => [p.portfolioId, p]));
		const asOf = new Date().toISOString().slice(0, 10);

		const result: SharedPortfolioMetrics[] = [];
		// Uma carteira por vez: o limite de consultas de preço vale para a chamada.
		for (const id of portfolioIds) {
			const portfolio = byId.get(id);
			if (!portfolio) continue;
			result.push(
				await this.metricsOf(portfolio, asOf, ctx.orgId, clientProfileId)
			);
		}
		return result;
	}

	/**
	 * Caminho de sistema (job de atenção): sem contexto de usuário, sem
	 * `ensureCanAccessClient` e sem auditoria, mas com as mesmas checagens de
	 * relação ACTIVE, consentimento ACTIVE e dono do perfil
	 * (`NoActiveConsentError` sem elas). Uma carteira que falha volta com
	 * `metrics: null` e não derruba as outras.
	 */
	async getSharedMetricsForSystem(
		orgId: string,
		clientProfileId: string,
		now: Date = new Date()
	): Promise<SharedPortfolioSystemMetrics[]> {
		const { ownerUserId, portfolioIds } = await this.consentedShare(
			orgId,
			clientProfileId
		);
		const data = await this.source.read(ownerUserId, portfolioIds);
		const byId = new Map(data.map((p) => [p.portfolioId, p]));
		const asOf = now.toISOString().slice(0, 10);

		const result: SharedPortfolioSystemMetrics[] = [];
		for (const id of portfolioIds) {
			const portfolio = byId.get(id);
			if (!portfolio) continue;
			try {
				const { metrics } = await this.metricsOf(
					portfolio,
					asOf,
					orgId,
					clientProfileId
				);
				result.push({ portfolioId: id, metrics });
			} catch {
				result.push({
					portfolioId: id,
					metrics: null,
					unavailableReason: SHARED_METRICS_FAILED,
				});
			}
		}
		return result;
	}

	/** Acesso do assessor e depois as checagens de `consentedShare`. */
	private async activeShare(
		ctx: AccessContext,
		clientProfileId: string
	): Promise<{ ownerUserId: string; portfolioIds: string[] }> {
		await this.authorization.ensureCanAccessClient(
			ctx,
			clientProfileId,
			'VIEW_PORTFOLIO'
		);
		return this.consentedShare(ctx.orgId, clientProfileId);
	}

	/**
	 * Relação ACTIVE da org com o cliente, consentimento ACTIVE dessa relação
	 * e dono do perfil, nessa ordem, sem cache.
	 */
	private async consentedShare(
		orgId: string,
		clientProfileId: string
	): Promise<{ ownerUserId: string; portfolioIds: string[] }> {
		const relationship = await this.relationships.findByOrgAndClient(
			orgId,
			clientProfileId
		);
		if (!relationship || relationship.status !== RelationshipStatus.Active) {
			throw new NoActiveConsentError();
		}
		const consent = await this.consents.findActiveByRelationship(
			relationship.id
		);
		if (
			!consent ||
			consent.status !== ConsentStatus.Active ||
			consent.relationshipId !== relationship.id ||
			consent.orgId !== orgId ||
			consent.clientProfileId !== clientProfileId
		) {
			throw new NoActiveConsentError();
		}
		const profile = await this.profiles.findById(clientProfileId);
		if (
			!profile ||
			profile.orgId !== orgId ||
			profile.origin !== ProfileOrigin.ClientCreated ||
			!profile.ownerUserId ||
			profile.ownerUserId !== consent.userId
		) {
			throw new NoActiveConsentError();
		}
		return {
			ownerUserId: profile.ownerUserId,
			portfolioIds: [...consent.portfolioIds],
		};
	}

	private async metricsOf(
		portfolio: SharedPortfolioData,
		asOf: string,
		orgId: string,
		clientProfileId: string
	): Promise<SharedPortfolioMetrics> {
		const { ledger, holdingsWithoutHistory, unreconciledSymbols } =
			reconcileSharedPortfolio(portfolio, { orgId, clientProfileId });

		const from = ledger.reduce(
			(min, t) => (t.tradeDate < min ? t.tradeDate : min),
			daysBefore(asOf, LAST_CLOSE_LOOKBACK_DAYS)
		);
		const closes = await this.market.loadCloses(
			[...ledger, ...holdingsWithoutHistory],
			from,
			asOf
		);
		const window = measuredWindow({ asOf, ledger, closes });
		const benchmarkReturns = window
			? await this.market.loadBenchmarks(window.from, window.to)
			: {};

		return {
			portfolioId: portfolio.portfolioId,
			name: portfolio.name,
			metrics: buildPortfolioMetrics({
				asOf,
				ledger,
				closes,
				target: null,
				benchmarkReturns,
				holdingsWithoutHistory,
			}),
			unreconciledSymbols,
		};
	}
}
