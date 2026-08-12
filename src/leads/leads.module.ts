import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailModule } from 'src/notifications/email/email.module';
import { SubscriptionModel } from 'src/subscription/schema';
import { LeadsController } from './leads.controller';
import { PurchaseIntentService } from './leads.service';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Subscription', schema: SubscriptionModel.schema },
		]),
		EmailModule,
	],
	controllers: [LeadsController],
	providers: [PurchaseIntentService],
})
export class LeadsModule {}
