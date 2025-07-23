import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { WebhooksController } from './webhooks.controller';
import { StripeService } from './stripe.service';
import { WebhooksService } from './webhooks.service';
import { SubscriptionModel, UserSubscriptionModel } from './schema';
import { UsersService } from 'src/users/users.service';
import { UsersController } from 'src/users/users.controller';
import { UsersModule } from 'src/users/users.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Subscription', schema: SubscriptionModel.schema },
			{ name: 'UserSubscription', schema: UserSubscriptionModel.schema },
		]),
		UsersModule,
	],
	controllers: [SubscriptionController, WebhooksController, UsersController],
	providers: [
		SubscriptionService,
		StripeService,
		WebhooksService,
		UsersService,
	],
	exports: [SubscriptionService, StripeService, WebhooksService],
})
export class SubscriptionModule {}
