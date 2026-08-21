import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { WebhooksController } from './webhooks.controller';
import { StripeService } from './stripe.service';
import { WebhooksService } from './webhooks.service';
import { SubscriptionModel, UserSubscriptionModel } from './schema';
import { UsersController } from 'src/users/users.controller';
import { UsersModule } from 'src/users/users.module';
import Stripe from 'stripe';
import { USER_PLAN_RESOLVER } from 'src/subscription/application/user-plan.types';
import { SubscriptionUserPlanResolver } from 'src/subscription/application/subscription-user-plan.resolver';

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
		SubscriptionUserPlanResolver,
		{
			provide: USER_PLAN_RESOLVER,
			useExisting: SubscriptionUserPlanResolver,
		},
		SubscriptionService,
		StripeService,
		WebhooksService,
		{
			provide: Stripe,
			useFactory: () =>
				new Stripe(process.env.STRIPE_PRIVATE_API_KEY!, {
					apiVersion: '2025-08-27.basil',
				}),
		},
	],
	exports: [
		SubscriptionService,
		StripeService,
		WebhooksService,
		USER_PLAN_RESOLVER,
	],
})
export class SubscriptionModule {}
