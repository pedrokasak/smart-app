import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailModule } from 'src/notifications/email/email.module';
import { UsersModule } from 'src/users/users.module';
import { UserSubscriptionModel } from 'src/subscription/schema';
import { NotificationModel } from './schema/notification.model';
import { NotificationsService } from './application/notifications.service';
import { SubscriptionExpiringScheduler } from './application/subscription-expiring.scheduler';
import { NOTIFICATION_CHANNELS } from './channels/notification-channel.port';
import { EmailNotificationChannel } from './channels/email-notification.channel';
import { PushNotificationChannel } from './channels/push-notification.channel';
import { NotificationsAdminController } from './admin/notifications-admin.controller';

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
	],
	controllers: [NotificationsAdminController],
	providers: [
		NotificationsService,
		EmailNotificationChannel,
		PushNotificationChannel,
		SubscriptionExpiringScheduler,
		{
			provide: NOTIFICATION_CHANNELS,
			useFactory: (
				email: EmailNotificationChannel,
				push: PushNotificationChannel
			) => [email, push],
			inject: [EmailNotificationChannel, PushNotificationChannel],
		},
	],
	exports: [NotificationsService],
})
export class NotificationsModule {}
