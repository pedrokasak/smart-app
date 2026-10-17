import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
	MARKET_DATA_PROVIDER,
	type MarketAssetType,
	type MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import { computeCorrelationMatrix } from 'src/portfolio/history/asset-correlation';
import { correlationAlerts } from './radar-correlation';
import { TradeModel } from 'src/fiscal/schema/trade.model';
import { InvestmentPolicyService } from 'src/investment-policy/investment-policy.service';
import { withDerivedAveragePrice } from 'src/portfolio/derive-average-price';
import type { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import { PortfolioErrorRadarService } from './portfolio-error-radar.service';
import type { PortfolioErrorRadarOutput } from './portfolio-error-radar.types';
import type { RadarHolding } from './radar-evidence';

interface RawAsset {
	symbol?: string;
	type?: string;
	quantity?: number;
	price?: number;
	avgPrice?: number;
	currentPrice?: number;
	currentPriceAt?: Date | string;
	source?: string;
}

const TAX_TYPES = new Set(['stock', 'fii', 'crypto', 'etf', 'fund', 'other']);
/** Com série diária de bolsa (COTAHIST guardado antes do Yahoo, TRA-251). */
const CORRELATION_TYPES = new Set(['stock', 'fii', 'etf']);
/** Maiores posições na matriz: 8 séries, no máximo 28 pares. */
const MAX_CORRELATION_SYMBOLS = 8;

/**
 * Mesma normalização do `toPositions` do AiController: "PETR4.SA" vira
 * "PETR4", senão a posição não casa com o peso calculado e perde a ação.
 */
export function radarSymbol(value: unknown): string {
	const symbol = String(value ?? '')
		.trim()
		.toUpperCase()
		.replace(/\s+/g, '')
		.replace(/^\$/, '');
	const withSuffix = symbol.match(/^([A-Z]{4}\d{1,2})\.(SA|B3)$/);
	return withSuffix ? withSuffix[1] : symbol;
}

const toTime = (value: Date | string | undefined) => {
	const time = value ? new Date(value).getTime() : NaN;
	return Number.isFinite(time) ? time : null;
};

/**
 * Monta o contexto do usuário para o Radar Anti-Erro dos Insights IA: a
 * política de investimento, o custo de cada posição (o mesmo preço médio
 * derivado das negociações que a carteira mostra) e a data das cotações.
 */
@Injectable()
export class UserErrorRadarService {
	private readonly logger = new Logger(UserErrorRadarService.name);

	constructor(
		private readonly radar: PortfolioErrorRadarService,
		private readonly investmentPolicy: InvestmentPolicyService,
		@Optional()
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketData?: MarketDataProviderPort
	) {}

	async detect(
		userId: string,
		assets: RawAsset[],
		positions: PortfolioIntelligencePosition[]
	): Promise<PortfolioErrorRadarOutput> {
		const [policyView, trades] = await Promise.all([
			this.investmentPolicy.get(userId),
			TradeModel.find({ userId })
				.select('symbol side quantity price fees date')
				.lean(),
		]);

		const withCost = withDerivedAveragePrice(
			assets.map((asset) => ({
				...asset,
				symbol: radarSymbol(asset.symbol),
			})),
			trades as any
		);

		const holdings: RadarHolding[] = withCost.flatMap((asset) => {
			const quantity = Number(asset.quantity) || 0;
			const price =
				Number(asset.currentPrice) > 0
					? Number(asset.currentPrice)
					: Number(asset.price) || 0;
			if (!asset.symbol || !(quantity > 0) || !(price > 0)) return [];
			// Lançamento manual guarda o preço de compra em `price`.
			const unitCost =
				Number(asset.avgPrice) > 0
					? Number(asset.avgPrice)
					: asset.source === 'manual' && Number(asset.price) > 0
						? Number(asset.price)
						: null;
			return [
				{
					symbol: asset.symbol,
					assetType: (TAX_TYPES.has(String(asset.type))
						? asset.type
						: 'other') as RadarHolding['assetType'],
					quantity,
					price,
					totalCost: unitCost === null ? null : unitCost * quantity,
				},
			];
		});

		const latest = Math.max(
			...assets.map((asset) => toTime(asset.currentPriceAt) ?? 0),
			0
		);

		const output = this.radar.detectForUser(positions, {
			policy: policyView.policy,
			holdings,
			pricesAsOf: latest > 0 ? new Date(latest).toISOString() : null,
		});
		if (output.status !== 'ok') return output;
		const correlation = await this.correlationAlerts(holdings);
		return correlation.length
			? { ...output, alerts: [...output.alerts, ...correlation] }
			: output;
	}

	/**
	 * Pares das maiores posições de bolsa que andam juntos (TRA-70).
	 * Best-effort: série que falta só tira o par da conta, e falha da fonte
	 * deixa o radar sem alerta de correlação, nunca sem resposta.
	 */
	private async correlationAlerts(holdings: RadarHolding[]) {
		const marketData = this.marketData;
		if (!marketData) return [];
		const valueOf = (h: RadarHolding) => h.quantity * h.price;
		const total = holdings.reduce((sum, h) => sum + valueOf(h), 0);
		const listed = holdings
			.filter((h) => CORRELATION_TYPES.has(h.assetType))
			.sort((a, b) => valueOf(b) - valueOf(a))
			.slice(0, MAX_CORRELATION_SYMBOLS);
		if (listed.length < 2 || !(total > 0)) return [];
		try {
			const entries = await Promise.all(
				listed.map(
					async (h) =>
						[
							h.symbol,
							await marketData.getDailyCloses(
								h.symbol,
								'1y',
								h.assetType as MarketAssetType
							),
						] as const
				)
			);
			const weightPct = Object.fromEntries(
				listed.map((h) => [h.symbol, (valueOf(h) / total) * 100])
			);
			return correlationAlerts(
				computeCorrelationMatrix(Object.fromEntries(entries)),
				weightPct
			);
		} catch (error) {
			this.logger.warn(
				`correlação do radar indisponível: ${(error as Error)?.message || error}`
			);
			return [];
		}
	}
}
