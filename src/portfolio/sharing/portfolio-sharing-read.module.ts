import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { assetSchema } from 'src/assets/schema/assets.model';
import { tradeSchema } from 'src/fiscal/schema/trade.model';
import { portfolioSchema } from 'src/portfolio/schema/portfolio.model';
import { PortfolioSharingReadService } from './portfolio-sharing-read.service';

/**
 * Leitura isolada das carteiras B2C para compartilhamento com o advisor.
 * Registra os models localmente (mesmo padrão de privacy.module.ts) para não
 * alterar módulos estáveis.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Portfolio', schema: portfolioSchema },
			{ name: 'Asset', schema: assetSchema },
			{ name: 'Trade', schema: tradeSchema },
		]),
	],
	providers: [PortfolioSharingReadService],
	exports: [PortfolioSharingReadService],
})
export class PortfolioSharingReadModule {}
