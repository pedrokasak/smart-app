import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationModel } from 'src/notifications/events/schema/notification.model';
import { PortfolioModule } from 'src/portfolio/portfolio.module';
import { IntelligenceModule } from 'src/intelligence/intelligence.module';
import { EmailModule } from 'src/notifications/email/email.module';
import { UsersModule } from 'src/users/users.module';
import { SubscriptionModule } from 'src/subscription/subscription.module';
import { PortfolioDigestBuilderService } from 'src/notifications/portfolio-digest/application/portfolio-digest-builder.service';
import { PortfolioDigestScheduler } from 'src/notifications/portfolio-digest/application/portfolio-digest.scheduler';
import { DigestUnsubscribeTokenService } from 'src/notifications/portfolio-digest/application/digest-unsubscribe-token.service';
import { DIGEST_NARRATOR } from 'src/notifications/portfolio-digest/application/digest-narrator.port';
import { TrackerrIaDigestNarratorAdapter } from 'src/notifications/portfolio-digest/infrastructure/trackerr-ia-digest-narrator.adapter';
import { DigestNotificationsService } from 'src/notifications/portfolio-digest/application/digest-notifications.service';
import { DigestNotificationsRepository } from 'src/notifications/portfolio-digest/infrastructure/digest-notifications.repository';
import { PortfolioDigestController } from 'src/notifications/portfolio-digest/portfolio-digest.controller';

@Module({
	imports: [
		HttpModule,
		/**
		 * Leitura das notificacoes da semana (TRA-136, fase 7). Registrado
		 * localmente porque o NotificationsModule nao re-exporta seus models —
		 * mesmo schema, e o Mongoose deduplica por nome, entao nao existe
		 * colecao paralela. O digest continua NAO dependendo do
		 * NotificationsModule: le a colecao, nao o pipeline de disparo.
		 */
		MongooseModule.forFeature([
			{ name: 'Notification', schema: NotificationModel.schema },
		]),
		PortfolioModule,
		IntelligenceModule,
		EmailModule,
		UsersModule, // expõe o Model('User') via MongooseModule re-exportado
		SubscriptionModule,
	],
	controllers: [PortfolioDigestController],
	providers: [
		PortfolioDigestBuilderService,
		PortfolioDigestScheduler,
		DigestNotificationsService,
		DigestNotificationsRepository,
		DigestUnsubscribeTokenService,
		TrackerrIaDigestNarratorAdapter,
		{ provide: DIGEST_NARRATOR, useExisting: TrackerrIaDigestNarratorAdapter },
	],
})
export class PortfolioDigestModule {}
