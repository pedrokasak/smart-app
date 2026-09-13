import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { assetSchema } from 'src/assets/schema/assets.model';
import { portfolioSchema } from 'src/portfolio/schema/portfolio.model';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { TargetAllocationModule } from 'src/portfolio/target-allocation/target-allocation.module';
import { PortfolioEvaluationScheduler } from './portfolio-evaluation.scheduler';
import { PortfolioScoreProducer } from './portfolio-score.producer';

/**
 * Avaliacao periodica da carteira (TRA-136, fase 4).
 *
 * Modulo proprio para nao inchar `PortfolioModule` (que ja carrega
 * adaptadores de mercado) nem `TargetAllocationModule` (que e sobre a meta,
 * nao sobre o score). Depende dos dois pelas portas publicas que eles ja
 * exportam.
 *
 * Portfolio e Asset sao registrados localmente — mesmos schemas, o Mongoose
 * deduplica por nome, entao nao ha colecao paralela.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Portfolio', schema: portfolioSchema },
			{ name: 'Asset', schema: assetSchema },
		]),
		PortfolioModule,
		TargetAllocationModule,
	],
	providers: [PortfolioScoreProducer, PortfolioEvaluationScheduler],
	exports: [PortfolioScoreProducer],
})
export class PortfolioEvaluationModule {}
