import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TargetAllocationController } from './target-allocation.controller';
import { TargetAllocationService } from './target-allocation.service';
import { PortfolioTargetAllocationModel } from './schema/portfolio-target-allocation.model';
import { portfolioSchema } from 'src/portfolio/schema/portfolio.model';
import { assetSchema } from 'src/assets/schema/assets.model';
import { AllocationBreachProducer } from './application/allocation-breach.producer';

@Module({
	imports: [
		MongooseModule.forFeature([
			{
				name: 'PortfolioTargetAllocation',
				schema: PortfolioTargetAllocationModel.schema,
			},
			// Registrados localmente so para o produtor calcular a exposicao
			// real. Mesmos schemas — o Mongoose deduplica por nome, entao nao
			// ha colecao paralela, e o modulo continua sem importar
			// PortfolioModule/AssetsModule (que ja se importam em ciclo).
			{ name: 'Portfolio', schema: portfolioSchema },
			{ name: 'Asset', schema: assetSchema },
		]),
	],
	providers: [TargetAllocationService, AllocationBreachProducer],
	controllers: [TargetAllocationController],
	exports: [TargetAllocationService, AllocationBreachProducer],
})
export class TargetAllocationModule {}
