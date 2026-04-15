import {
	MiddlewareConsumer,
	Module,
	NestModule,
	RequestMethod,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { ConnectDatabase } from './database/database.service';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthenticationModule } from './authentication/authentication.module';
import { ProfileModule } from './profile/profile.module';
import { AddressModule } from './address/address.module';
import { PermissionsModule } from './permissions/permissions.module';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './authentication/jwt-auth.guard';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { StockModule } from './stocks/stocks.module';
import { AssetsModule } from './assets/assets.module';
import { AiModule } from './ai/ai.module';
import { TwoFactorModule } from './two-factor/two-factor.module';
import { BrokerSyncModule } from './broker-sync/broker-sync.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { PortfolioModule } from './portfolio/portfolio.module';
import { EndpointRateLimitMiddleware } from 'src/security/rate-limit/endpoint-rate-limit.middleware';

@Module({
	imports: [
		AuthenticationModule,
		UsersModule,
		ProfileModule,
		AddressModule,
		PermissionsModule,
		MongooseModule.forRoot(process.env.DATABASE_URL),
		SchedulerModule,
		SubscriptionModule,
		StockModule,
		AssetsModule,
		AiModule,
		TwoFactorModule,
		BrokerSyncModule,
		PortfolioModule,
		FiscalModule,
	],
	controllers: [AppController],
	providers: [
		AppService,
		ConnectDatabase,
		{ provide: APP_GUARD, useClass: JwtAuthGuard },
	],
})
export class AppModule implements NestModule {
	configure(consumer: MiddlewareConsumer) {
		consumer
			.apply(EndpointRateLimitMiddleware)
			.forRoutes({ path: '*', method: RequestMethod.ALL });
	}
}
