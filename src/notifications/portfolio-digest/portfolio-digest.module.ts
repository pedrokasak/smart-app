import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
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
import { PortfolioDigestController } from 'src/notifications/portfolio-digest/portfolio-digest.controller';

@Module({
	imports: [
		HttpModule,
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
		DigestUnsubscribeTokenService,
		TrackerrIaDigestNarratorAdapter,
		{ provide: DIGEST_NARRATOR, useExisting: TrackerrIaDigestNarratorAdapter },
	],
})
export class PortfolioDigestModule {}
