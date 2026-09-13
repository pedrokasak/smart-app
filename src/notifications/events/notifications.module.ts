import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailModule } from 'src/notifications/email/email.module';
import { UsersModule } from 'src/users/users.module';
import { UserSubscriptionModel } from 'src/subscription/schema';
import { NotificationModel } from './schema/notification.model';
import { NotificationsService } from './application/notifications.service';
import { SubscriptionExpiringScheduler } from './application/subscription-expiring.scheduler';
import { NotificationEventConsumer } from './application/notification-event.consumer';
import { NOTIFICATION_CHANNELS } from './channels/notification-channel.port';
import { EmailNotificationChannel } from './channels/email-notification.channel';
import { PushNotificationChannel } from './channels/push-notification.channel';
import { NotificationsAdminController } from './admin/notifications-admin.controller';
import { InAppNotificationsController } from './in-app-notifications.controller';
import { InAppNotificationsService } from './application/in-app-notifications.service';
import { InAppNotificationsRepository } from './infrastructure/in-app-notifications.repository';
import { AiModule } from 'src/ai/ai.module';
import { ThresholdsModule } from 'src/thresholds/thresholds.module';
import { NOTIFICATION_SUMMARY_PROVIDER } from './application/ports/notification-summary.port';
import { TrackerrIaNotificationSummaryAdapter } from './infrastructure/trackerr-ia-notification-summary.adapter';

/**
 * Modulo agnostico de canal. Adicionar um canal:
 *   1. implementar NotificationChannel
 *   2. registrar como provider
 *   3. adicionar a lista em NOTIFICATION_CHANNELS abaixo
 *
 * Ordem no array define a ordem de tentativa por notify().
 *
 * UserSubscription registrado localmente (SubscriptionModule nao re-exporta
 * seus models). E o mesmo schema — Mongoose deduplica por nome, entao nao
 * cria colecao paralela.
 */
@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: 'Notification', schema: NotificationModel.schema },
			{
				name: 'UserSubscription',
				schema: UserSubscriptionModel.schema,
			},
		]),
		EmailModule,
		UsersModule,
		// Motor de limiares (TRA-136, fase 4): decide, antes do disparo, se
		// o evento merece virar notificacao.
		ThresholdsModule,
		// Cliente do trackerr-ia ja existente (TRA-133). Importado para
		// REUSAR `AiService.getInsights` no enriquecimento da fase 5 — este
		// modulo nao abre um segundo cliente HTTP.
		AiModule,
	],
	controllers: [NotificationsAdminController, InAppNotificationsController],
	providers: [
		NotificationsService,
		// Leitura do centro in-app (TRA-136, fase 4). Separado do
		// NotificationsService, que e o lado de escrita/disparo.
		InAppNotificationsService,
		InAppNotificationsRepository,
		EmailNotificationChannel,
		PushNotificationChannel,
		SubscriptionExpiringScheduler,
		// Consumidor da fila de eventos (TRA-136, fase 3). Ele se registra no
		// EventConsumerRegistry no bootstrap — o EventsModule (@Global) nao
		// precisa conhecer este modulo.
		NotificationEventConsumer,
		TrackerrIaNotificationSummaryAdapter,
		{
			provide: NOTIFICATION_SUMMARY_PROVIDER,
			useExisting: TrackerrIaNotificationSummaryAdapter,
		},
		{
			provide: NOTIFICATION_CHANNELS,
			useFactory: (
				email: EmailNotificationChannel,
				push: PushNotificationChannel
			) => [email, push],
			inject: [EmailNotificationChannel, PushNotificationChannel],
		},
	],
	exports: [NotificationsService, InAppNotificationsService],
})
export class NotificationsModule {}
