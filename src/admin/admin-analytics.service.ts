import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subscription } from 'src/subscription/schema/subscription.model';
import { UserSubscription } from 'src/subscription/schema/user-subscription.model';
import {
	type AdminAnalytics,
	computeAdminAnalytics,
} from './domain/admin-analytics';

/**
 * Lê o espelho de assinaturas e planos e entrega as métricas do dashboard
 * admin (TRA-158). Só os campos de que a conta precisa: nenhum dado do
 * usuário (nem o id) sai do banco para esta rota.
 */
@Injectable()
export class AdminAnalyticsService {
	constructor(
		@InjectModel('Subscription')
		private readonly subscriptionModel: Model<Subscription>,
		@InjectModel('UserSubscription')
		private readonly userSubscriptionModel: Model<UserSubscription>
	) {}

	async getAnalytics(now: Date = new Date()): Promise<AdminAnalytics> {
		const [plans, subscriptions] = await Promise.all([
			this.subscriptionModel.find().select('name price annualPrice').lean(),
			this.userSubscriptionModel
				.find()
				.select(
					'-_id plan status paymentProvider currentPeriodStart currentPeriodEnd createdAt canceledAt endedAt updatedAt'
				)
				.lean(),
		]);

		return computeAdminAnalytics(
			(subscriptions as any[]).map((sub) => ({
				planId: String(sub.plan),
				status: sub.status,
				paymentProvider: sub.paymentProvider ?? null,
				currentPeriodStart: new Date(sub.currentPeriodStart),
				currentPeriodEnd: new Date(sub.currentPeriodEnd),
				createdAt: sub.createdAt ? new Date(sub.createdAt) : null,
				canceledAt: sub.canceledAt ? new Date(sub.canceledAt) : null,
				endedAt: sub.endedAt ? new Date(sub.endedAt) : null,
				updatedAt: sub.updatedAt ? new Date(sub.updatedAt) : null,
			})),
			(plans as any[]).map((plan) => ({
				id: String(plan._id),
				name: String(plan.name),
				price: Number(plan.price) || 0,
				annualPrice: plan.annualPrice != null ? Number(plan.annualPrice) : null,
			})),
			now
		);
	}
}
