import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FiscalService } from 'src/fiscal/fiscal.service';
import { AveragePriceService } from 'src/fiscal/services/average-price.service';
import { tradeSchema } from 'src/fiscal/schema/trade.model';

@Module({
	imports: [
		MongooseModule.forFeature([{ name: 'Trade', schema: tradeSchema }]),
	],
	providers: [FiscalService, AveragePriceService],
	exports: [FiscalService],
})
export class FiscalModule {}
