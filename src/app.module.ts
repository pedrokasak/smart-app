import { Module } from '@nestjs/common';
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
	],
	controllers: [AppController],
	providers: [
		AppService,
		ConnectDatabase,
		{ provide: APP_GUARD, useClass: JwtAuthGuard },
	],
})
export class AppModule {}
