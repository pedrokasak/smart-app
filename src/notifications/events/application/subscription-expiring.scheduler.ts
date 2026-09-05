import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserSubscription } from 'src/subscription/schema/user-subscription.model';
import {
	EVENT_PUBLISHER,
	EventPublisher,
} from 'src/events/application/ports/event-publisher.port';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { deterministicEventId } from 'src/events/domain/deterministic-event-id';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';

/**
 * Escaneia UserSubscription 1x/dia e PUBLICA `subscription.expiring` para
 * quem esta a 7, 3 e 1 dia(s) de expirar. Quem notifica e o consumidor da
 * fila (TRA-136, fase 3) — este cron parou de chamar o
 * NotificationsService direto.
 *
 * A troca importa por dois motivos: o trabalho falivel (Resend, push) sai
 * do processo do cron para o worker, com retry e dead-letter; e o mesmo
 * fato passa a poder alimentar outros assinantes sem que o cron saiba
 * deles.
 *
 * A protecao contra disparo repetido continua existindo, so mudou de
 * lugar. Antes era a `dedupeKey` de dominio (`expiring:<dias>:<dia>`);
 * agora e o proprio `event.id`, derivado dos mesmos componentes do fato
 * (usuario, dias, dia do vencimento) via `deterministicEventId`. Rodar o
 * cron duas vezes gera o MESMO id, que morre na deduplicacao por jobId do
 * BullMQ e, se passar, na do NotificationsService.
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
		@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher
	) {}

	@Cron(CronExpression.EVERY_DAY_AT_8AM, {
		name: 'notifications-subscription-expiring',
		timeZone: 'America/Sao_Paulo',
	})
	async runDaily(): Promise<void> {
		try {
			const dispatched = await this.dispatch(new Date());
			this.logger.log(
				`Subscription-expiring: ${dispatched} evento(s) publicado(s)`
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(`Subscription-expiring falhou: ${message}`);
		}
	}

	/**
	 * Extraido pra facilitar teste. Recebe `now` pra tornar o calculo
	 * deterministico. Nunca lanca por evento: `publish` do barramento
	 * in-process ja engole falha de assinante, e o `runDaily` captura o
	 * resto — um dia sem evento e melhor que um cron morto.
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

			const userId = String(sub.user);
			await this.publisher.publish(
				createDomainEvent({
					// Id derivado do fato: o cron rodando de novo no mesmo dia
					// reemite o mesmo id, que e ignorado rio abaixo.
					id: deterministicEventId(
						DOMAIN_EVENT_TYPES.SubscriptionExpiring,
						userId,
						days,
						toDayKey(sub.currentPeriodEnd)
					),
					type: DOMAIN_EVENT_TYPES.SubscriptionExpiring,
					subject: userId,
					producer: 'server.subscription.expiring',
					payload: {
						planName,
						expiresAt: new Date(sub.currentPeriodEnd).toISOString(),
						daysUntilExpiration: days,
					},
				})
			);
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
