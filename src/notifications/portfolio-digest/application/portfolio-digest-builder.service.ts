import { Injectable } from '@nestjs/common';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { PortfolioErrorRadarService } from 'src/intelligence/application/portfolio-error-radar.service';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import {
	DigestMover,
	DigestWatchItem,
	PortfolioDigestFacts,
} from 'src/notifications/portfolio-digest/domain/portfolio-digest.types';

const DEFAULT_PERIOD_DAYS = 7;
// Abaixo disso, oscilacao normal de mercado vira watch item toda semana —
// ruido, nao sinal.
const BELOW_AVERAGE_COST_THRESHOLD_PCT = 5;

/**
 * Monta os fatos deterministicos do digest semanal a partir do que ja existe
 * no server — nenhuma chamada nova a provider de mercado. `topGainers`/
 * `topLosers` usam `asset.change24h`, ja persistido e atualizado pelo
 * enrich; nao e a variacao da semana, e do dia do envio (ver
 * DigestMover.changePercent). Buscar a variacao real da semana exigiria
 * historico de preco por ativo no Yahoo, mesmo provider fragil que ja da
 * 429 hoje (TRA-32) — deliberadamente fora do escopo (ver TRA-70).
 */
@Injectable()
export class PortfolioDigestBuilderService {
	constructor(
		private readonly portfolioService: PortfolioService,
		private readonly portfolioErrorRadarService: PortfolioErrorRadarService
	) {}

	async build(
		userId: string,
		periodDays: number = DEFAULT_PERIOD_DAYS
	): Promise<PortfolioDigestFacts> {
		const periodEndDate = new Date();
		const periodStartDate = new Date(periodEndDate);
		periodStartDate.setDate(periodStartDate.getDate() - periodDays);

		const periodStart = this.toLocalIsoDate(periodStartDate);
		const periodEnd = this.toLocalIsoDate(periodEndDate);

		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const assets = portfolios.flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);

		if (assets.length === 0) {
			return this.emptyFacts(periodStart, periodEnd);
		}

		const history = await this.portfolioService.getUserPortfolioHistory(
			userId,
			periodStart,
			periodEnd
		);

		const currentValue = assets.reduce(
			(sum: number, asset: any) => sum + Number(asset?.total || 0),
			0
		);
		const startValue = history.length > 0 ? history[0].totalValue : null;
		const periodChangeAbs =
			startValue !== null
				? Number((currentValue - startValue).toFixed(2))
				: null;
		const periodChangePct =
			startValue !== null && startValue > 0
				? Number(((periodChangeAbs! / startValue) * 100).toFixed(2))
				: null;

		const movers = this.resolveMovers(assets);
		const watchItems = this.resolveWatchItems(assets);
		const dividendsReceived = this.sumDividends(
			assets,
			periodStartDate,
			periodEndDate
		);

		return {
			periodStart,
			periodEnd,
			portfolioValue: Number(currentValue.toFixed(2)),
			periodChangePct,
			periodChangeAbs,
			topGainers: movers.gainers,
			topLosers: movers.losers,
			watchItems,
			dividendsReceived,
			hasSufficientData: true,
		};
	}

	private emptyFacts(
		periodStart: string,
		periodEnd: string
	): PortfolioDigestFacts {
		return {
			periodStart,
			periodEnd,
			portfolioValue: null,
			periodChangePct: null,
			periodChangeAbs: null,
			topGainers: [],
			topLosers: [],
			watchItems: [],
			dividendsReceived: null,
			hasSufficientData: false,
		};
	}

	private resolveMovers(assets: any[]): {
		gainers: DigestMover[];
		losers: DigestMover[];
	} {
		const movers: DigestMover[] = assets
			.filter((asset) => typeof asset?.change24h === 'number')
			.map((asset) => ({
				symbol: String(asset.symbol || '').toUpperCase(),
				changePercent: Number(asset.change24h),
			}));

		const gainers = movers
			.filter((mover) => mover.changePercent > 0)
			.sort((a, b) => b.changePercent - a.changePercent)
			.slice(0, 3);

		const losers = movers
			.filter((mover) => mover.changePercent < 0)
			.sort((a, b) => a.changePercent - b.changePercent)
			.slice(0, 3);

		return { gainers, losers };
	}

	private resolveWatchItems(assets: any[]): DigestWatchItem[] {
		const items: DigestWatchItem[] = [];

		const positions = this.toPositions(assets);
		const radar = this.portfolioErrorRadarService.detect(positions);
		const concentrationAlert = radar.alerts.find(
			(alert) => alert.code === 'ASSET_CONCENTRATION_HIGH'
		);
		if (concentrationAlert?.symbol) {
			items.push({
				symbol: concentrationAlert.symbol,
				reason: 'concentration_above_threshold',
				detail: concentrationAlert.message,
			});
		}

		const belowCost = assets
			.map((asset) => {
				const avgPrice = Number(asset?.avgPrice || 0);
				const currentPrice = Number(asset?.currentPrice || 0);
				if (avgPrice <= 0 || currentPrice <= 0) return null;
				const pct = ((currentPrice - avgPrice) / avgPrice) * 100;
				if (pct >= -BELOW_AVERAGE_COST_THRESHOLD_PCT) return null;
				return {
					symbol: String(asset.symbol || '').toUpperCase(),
					pct: Number(pct.toFixed(1)),
				};
			})
			.filter((entry): entry is { symbol: string; pct: number } => !!entry)
			.sort((a, b) => a.pct - b.pct);

		for (const entry of belowCost) {
			if (items.length >= 3) break;
			items.push({
				symbol: entry.symbol,
				reason: 'below_average_cost',
				detail: `${entry.symbol} está ${Math.abs(entry.pct).toFixed(1)}% abaixo do preço médio.`,
			});
		}

		return items.slice(0, 3);
	}

	private sumDividends(
		assets: any[],
		periodStart: Date,
		periodEnd: Date
	): number | null {
		let total = 0;
		let hasHistory = false;

		for (const asset of assets) {
			const history = Array.isArray(asset?.dividendHistory)
				? asset.dividendHistory
				: [];
			for (const entry of history) {
				const date = new Date(entry?.date);
				if (!Number.isFinite(date.getTime())) continue;
				hasHistory = true;
				if (date >= periodStart && date <= periodEnd) {
					total += Number(entry?.value || 0);
				}
			}
		}

		return hasHistory ? Number(total.toFixed(2)) : null;
	}

	// Mesma conversao usada em AiController.toPositions e
	// TrackerrScoreService — duplicada deliberadamente, mesmo motivo: nao
	// tocar naqueles arquivos por um consumidor novo.
	private toPositions(assets: any[]): PortfolioIntelligencePosition[] {
		return assets
			.map((asset: any) => ({
				symbol: String(asset?.symbol || '').toUpperCase(),
				assetType: (asset?.type || 'other') as
					| 'stock'
					| 'fii'
					| 'crypto'
					| 'etf'
					| 'fund'
					| 'other',
				quantity: Number(asset?.quantity || 0),
				totalValue:
					typeof asset?.total === 'number' && asset.total > 0
						? asset.total
						: undefined,
				price: typeof asset?.price === 'number' ? asset.price : undefined,
				currentPrice:
					typeof asset?.currentPrice === 'number'
						? asset.currentPrice
						: undefined,
				sector: typeof asset?.sector === 'string' ? asset.sector : null,
			}))
			.filter((position) => !!position.symbol);
	}

	private toLocalIsoDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}
}
