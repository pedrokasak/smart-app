import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { WebhooksController } from './webhooks.controller';
import { StripeService } from './stripe.service';
import { WebhooksService } from './webhooks.service';
import { SubscriptionModel, UserSubscriptionModel } from './schema';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Subscription', schema: SubscriptionModel.schema },
			{ name: 'UserSubscription', schema: UserSubscriptionModel.schema },
		]),
	],
	controllers: [SubscriptionController, WebhooksController],
	providers: [SubscriptionService, StripeService, WebhooksService],
	exports: [SubscriptionService, StripeService, WebhooksService],
})
export class SubscriptionModule {}
