import { forwardRef, Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { assetSchema } from 'src/assets/schema/assets.model';
import { PortfolioModule } from 'src/portfolio/portfolio.module';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: 'Asset', schema: assetSchema }]),
		forwardRef(() => PortfolioModule),
	],
	controllers: [AssetsController],
	providers: [AssetsService],
	exports: [AssetsService, MongooseModule],
})
export class AssetsModule {}
