import { Injectable } from '@nestjs/common';
import { AssetMapper } from 'src/assets/mappers/asset.mapper';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { PortfolioMarkToMarketService } from 'src/portfolio/valuation/portfolio-mark-to-market.service';
import {
	type Wallet,
	buildWallet,
	strictestPositionLimit,
} from './mobile-wallet';

/** Tela Carteira do app: posições de todas as carteiras, só leitura (ADR-001). */
@Injectable()
export class MobileWalletService {
	constructor(
		private readonly portfolios: PortfolioService,
		private readonly markToMarket: PortfolioMarkToMarketService
	) {}

	async getWallet(userId: string): Promise<Wallet> {
		const userPortfolios =
			(await this.portfolios.getUserPortfolios(userId)) || [];
		const assets = userPortfolios.flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);
		const marked = await this.markToMarket.apply(
			AssetMapper.toResponseDtoArray(assets)
		);
		return buildWallet(marked, strictestPositionLimit(userPortfolios));
	}
}
