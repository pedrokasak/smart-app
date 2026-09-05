import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from 'src/users/users.module';
import { NotificationsModule } from 'src/notifications/events/notifications.module';
import { NotificationModel } from 'src/notifications/events/schema/notification.model';
import { PushSubscriptionModel } from './schema/push-subscription.model';
import { PushSubscriptionRepository } from './infrastructure/push-subscription.repository';
import { PushSubscriptionsService } from './application/push-subscriptions.service';
import { PushSubscriptionsController } from './push-subscriptions.controller';
import { DailyPushDigestScheduler } from './application/daily-push-digest.scheduler';
import { WEB_PUSH_SENDER } from './application/ports/web-push-sender.port';
import { WebPushAdapter } from './infrastructure/web-push.adapter';
import { DisabledWebPushAdapter } from './infrastructure/disabled-web-push.adapter';
import { readVapidConfig } from './infrastructure/vapid.config';

/**
 * Web Push / VAPID (TRA-136, fase 6).
 *
 * Depende de `NotificationsModule` (para `NotificationsService.userAllows`)
 * e NUNCA o contrario: o canal `PushNotificationChannel` de la nao conhece
 * este modulo. A seta aponta em um sentido so, e por isso nao existe
 * `forwardRef` aqui.
 *
 * A escolha do adaptador acontece no bootstrap, uma vez: com par VAPID
 * presente entra o `WebPushAdapter`; sem ele, o null object
 * `DisabledWebPushAdapter`. Nenhum ponto do codigo pergunta depois "sera
 * que tem chave?" — a resposta ja esta encapsulada em quem foi injetado.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'PushSubscription', schema: PushSubscriptionModel.schema },
			// Mesmo schema de `NotificationsModule`. Mongoose deduplica por
			// nome, entao isto nao cria colecao paralela — mesmo padrao ja
			// usado la para `UserSubscription`.
			{ name: 'Notification', schema: NotificationModel.schema },
		]),
		// Exporta o model de `User`, usado pela reavaliacao de preferencias.
		UsersModule,
		NotificationsModule,
	],
	controllers: [PushSubscriptionsController],
	providers: [
		PushSubscriptionRepository,
		PushSubscriptionsService,
		DailyPushDigestScheduler,
		{
			provide: WEB_PUSH_SENDER,
			useFactory: () => {
				const config = readVapidConfig();
				return config
					? new WebPushAdapter(config)
					: new DisabledWebPushAdapter();
			},
		},
	],
	exports: [PushSubscriptionsService],
})
export class PushModule {}
