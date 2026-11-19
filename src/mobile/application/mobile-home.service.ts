import { Injectable, Logger } from '@nestjs/common';
import { MobileHomeResponseDto } from 'src/mobile/dto/mobile-home-response.dto';
import { PortfolioCompositionService } from 'src/portfolio/composition/portfolio-composition.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { PortfolioReturnsService } from 'src/portfolio/returns/portfolio-returns.service';
import { PortfolioMarkToMarketService } from 'src/portfolio/valuation/portfolio-mark-to-market.service';
import { AssetMapper } from 'src/assets/mappers/asset.mapper';
import {
	ALLOCATION_BUCKETS,
	computeBucketExposure,
} from 'src/portfolio/target-allocation/application/allocation-exposure';
import { UpcomingDividendsService } from 'src/portfolio/upcoming-dividends/upcoming-dividends.service';

/** Bloco mais lento que isto vira lacuna: o resto da tela não espera. */
export const HOME_SECTION_TIMEOUT_MS = 6000;

const withTimeout = <T>(work: Promise<T>): Promise<T> => {
	let timer: NodeJS.Timeout;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error('tempo esgotado')),
			HOME_SECTION_TIMEOUT_MS
		);
	});
	return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
};

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

/** Dias de hoje até o fim do mês, para os proventos "previstos neste mês". */
const daysUntilMonthEnd = (now: Date) => {
	const lastDay = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
	);
	return Math.max(1, lastDay.getUTCDate() - now.getUTCDate());
};

const twelveMonthsAgo = (now: Date) => {
	const from = new Date(now);
	from.setUTCFullYear(from.getUTCFullYear() - 1);
	return toIsoDate(from);
};

/**
 * Compõe a tela inicial do app em uma chamada. Só compõe e recorta: toda regra
 * e todo cálculo ficam nos serviços que o web também usa (ADR-001).
 */
@Injectable()
export class MobileHomeService {
	private readonly logger = new Logger(MobileHomeService.name);

	constructor(
		private readonly portfolios: PortfolioService,
		private readonly returns: PortfolioReturnsService,
		private readonly composition: PortfolioCompositionService,
		private readonly upcomingDividends: UpcomingDividendsService,
		private readonly markToMarket: PortfolioMarkToMarketService
	) {}

	async getHome(
		userId: string,
		now = new Date()
	): Promise<MobileHomeResponseDto> {
		const unavailable: string[] = [];
		const section = <T>(name: string, load: () => Promise<T>) =>
			withTimeout(load()).catch((error) => {
				this.logger.warn(
					`Home: bloco ${name} indisponível: ${(error as Error)?.message}`
				);
				unavailable.push(`${name}_failed`);
				return null;
			});

		const userPortfolios = await section('portfolios', () =>
			this.portfolios.getUserPortfolios(userId)
		);

		const [patrimony, dividends, yieldSection, allocation] = await Promise.all([
			section('patrimony', () => this.loadPatrimony(userId, now)),
			section('dividends', () =>
				this.loadDividends(userId, userPortfolios, now)
			),
			section('yield', () => this.loadYield(userId)),
			section('allocation', () => this.loadAllocation(userPortfolios)),
		]);

		return {
			patrimony,
			dividends,
			yield: yieldSection,
			allocation,
			unavailable,
		};
	}

	private async loadPatrimony(userId: string, now: Date) {
		const result = await this.returns.getReturnsSummary(userId, {
			from: twelveMonthsAgo(now),
		});
		return {
			totalValue: result.currentValue,
			twr12m: result.twr,
			asOf: result.asOf,
			staleDays: result.staleDays,
		};
	}

	private async loadDividends(
		userId: string,
		userPortfolios: unknown[] | null,
		now: Date
	) {
		// Sem saber as carteiras não dá para afirmar que não há proventos.
		if (!userPortfolios) throw new Error('carteiras indisponíveis');

		const summary = await this.upcomingDividends.listUpcoming(
			userId,
			userPortfolios.map((portfolio: any) => String(portfolio._id)),
			daysUntilMonthEnd(now),
			now
		);
		return {
			totalNetValue: summary.totalNetValue,
			payments: summary.items.length,
		};
	}

	private async loadYield(userId: string) {
		const { yield: result } = await this.composition.getComposition(userId);
		return {
			onMarket: result.portfolioYieldOnMarket,
			onCost: result.portfolioYieldOnCost,
			approximated: result.approximated,
		};
	}

	/** A mesma marcação a mercado do web, para os percentuais baterem. */
	private async loadAllocation(userPortfolios: unknown[] | null) {
		if (!userPortfolios) throw new Error('carteiras indisponíveis');

		const assets = userPortfolios.flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);
		const marked = await this.markToMarket.apply(
			AssetMapper.toResponseDtoArray(assets)
		);
		const exposure = computeBucketExposure(marked);
		return ALLOCATION_BUCKETS.map((bucket) => ({
			bucket,
			pct: Number(exposure[bucket]) || 0,
		}));
	}
}
