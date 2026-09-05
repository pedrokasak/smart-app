import { forwardRef, Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { assetSchema } from 'src/assets/schema/assets.model';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { portfolioSchema } from 'src/portfolio/schema/portfolio.model';
import { DividendReceivedProducer } from 'src/assets/events/dividend-received.producer';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Asset', schema: assetSchema },
			// Registrado localmente so para resolver o dono do provento
			// (Portfolio.userId) no produtor de evento. Mesmo schema — o
			// Mongoose deduplica por nome, entao nao ha colecao paralela.
			{ name: 'Portfolio', schema: portfolioSchema },
		]),
		forwardRef(() => PortfolioModule),
	],
	controllers: [AssetsController],
	providers: [AssetsService, DividendReceivedProducer],
	exports: [AssetsService, MongooseModule],
})
export class AssetsModule {}
