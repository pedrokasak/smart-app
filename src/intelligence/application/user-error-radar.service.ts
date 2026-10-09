import { Injectable } from '@nestjs/common';
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
	constructor(
		private readonly radar: PortfolioErrorRadarService,
		private readonly investmentPolicy: InvestmentPolicyService
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

		return this.radar.detectForUser(positions, {
			policy: policyView.policy,
			holdings,
			pricesAsOf: latest > 0 ? new Date(latest).toISOString() : null,
		});
	}
}
