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
import { PLAN_QUOTA_USAGE } from 'src/subscription/application/plan-quotas';
import { PlanQuotaService } from 'src/subscription/quotas/plan-quota.service';
import { MongoPlanQuotaUsage } from 'src/subscription/quotas/mongo-plan-quota-usage';
import { SubscriptionUserPlanResolver } from 'src/subscription/application/subscription-user-plan.resolver';
import { PlanSyncService } from 'src/subscription/plan-sync/plan-sync.service';
import { SubscriptionExpiryScheduler } from 'src/subscription/application/subscription-expiry.scheduler';
import { StripeSubscriptionSyncService } from 'src/subscription/application/stripe-subscription-sync.service';
import { CheckoutConfirmationService } from 'src/subscription/application/checkout-confirmation.service';

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
		PlanSyncService,
		SubscriptionExpiryScheduler,
		// Liberação do plano sem depender só do webhook (incidente 27/09/2026).
		StripeSubscriptionSyncService,
		CheckoutConfirmationService,
		PlanQuotaService,
		{ provide: PLAN_QUOTA_USAGE, useClass: MongoPlanQuotaUsage },
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
		PlanSyncService,
		USER_PLAN_RESOLVER,
		PlanQuotaService,
	],
})
export class SubscriptionModule {}
