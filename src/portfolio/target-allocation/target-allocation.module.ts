import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TargetAllocationController } from './target-allocation.controller';
import { TargetAllocationService } from './target-allocation.service';
import { PortfolioTargetAllocationModel } from './schema/portfolio-target-allocation.model';

@Module({
	imports: [
		MongooseModule.forFeature([
			{
				name: 'PortfolioTargetAllocation',
				schema: PortfolioTargetAllocationModel.schema,
			},
		]),
	],
	providers: [TargetAllocationService],
	controllers: [TargetAllocationController],
	exports: [TargetAllocationService],
})
export class TargetAllocationModule {}
