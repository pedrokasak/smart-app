import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserSubscription } from 'src/subscription/schema/user-subscription.model';
import { NotificationsService } from './notifications.service';
import { NotificationType } from '../domain/notification.types';

/**
 * Escaneia UserSubscription 1x/dia. Notifica quem esta a 7, 3 e 1 dia(s)
 * de expirar. Dedupe por (user, type, `expiring:<yyyy-mm-dd>`) na janela
 * de 24h — nunca dispara duas vezes no mesmo dia mesmo se o cron rodar
 * duas vezes (start/dev restart).
 *
 * Nao mexe em WebhooksService/StripeService de proposito: o Stripe ja
 * notifica o backend de eventos billing.* — este cron cobre a janela em
 * que o usuario esta prestes a *perder* acesso, nao a *renovar*.
 */
const ALERT_WINDOWS_DAYS = [7, 3, 1] as const;

@Injectable()
export class SubscriptionExpiringScheduler {
	private readonly logger = new Logger(SubscriptionExpiringScheduler.name);

	constructor(
		@InjectModel('UserSubscription')
		private readonly userSubscriptionModel: Model<UserSubscription>,
		private readonly notifications: NotificationsService
	) {}

	@Cron(CronExpression.EVERY_DAY_AT_8AM, {
		name: 'notifications-subscription-expiring',
		timeZone: 'America/Sao_Paulo',
	})
	async runDaily(): Promise<void> {
		try {
			const dispatched = await this.dispatch(new Date());
			this.logger.log(
				`Subscription-expiring: ${dispatched} notificacao(oes) processada(s)`
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(`Subscription-expiring falhou: ${message}`);
		}
	}

	/**
	 * Extraido pra facilitar teste. Recebe `now` pra tornar o calculo
	 * deterministico.
	 */
	async dispatch(now: Date): Promise<number> {
		const maxWindow = Math.max(...ALERT_WINDOWS_DAYS);
		const upperBound = new Date(now.getTime() + maxWindow * 24 * 60 * 60 * 1000);

		const candidates = await this.userSubscriptionModel
			.find({
				status: { $in: ['active', 'trialing'] },
				currentPeriodEnd: { $gte: now, $lte: upperBound },
				cancelAtPeriodEnd: false,
			})
			.populate('plan', 'name')
			.lean();

		let dispatched = 0;
		for (const sub of candidates) {
			const days = daysUntil(now, new Date(sub.currentPeriodEnd));
			if (!ALERT_WINDOWS_DAYS.includes(days as (typeof ALERT_WINDOWS_DAYS)[number])) {
				continue;
			}

			const plan = sub.plan as unknown as { name?: string } | null;
			const planName = plan?.name ?? 'Trakker';

			await this.notifications.notify({
				userId: sub.user,
				payload: {
					type: NotificationType.SubscriptionExpiring,
					planName,
					expiresAt: new Date(sub.currentPeriodEnd).toISOString(),
					daysUntilExpiration: days,
				},
				dedupeKey: `expiring:${days}:${toDayKey(sub.currentPeriodEnd)}`,
			});
			dispatched += 1;
		}
		return dispatched;
	}
}

function daysUntil(now: Date, end: Date): number {
	const diffMs = end.getTime() - now.getTime();
	return Math.max(0, Math.round(diffMs / (24 * 60 * 60 * 1000)));
}

function toDayKey(date: Date | string): string {
	const d = new Date(date);
	return d.toISOString().slice(0, 10);
}
