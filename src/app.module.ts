import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ConnectDatabase } from './database/database.service';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { AuthenticateModule } from './authentication/authentication.module';
import { ProfileModule } from './profile/profile.module';
import { PermissionsModule } from './permissions/permissions.module';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './authentication/jwt-auth.guard';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
	imports: [
		AuthenticateModule,
		UsersModule,
		ProfileModule,
		PermissionsModule,
		MongooseModule.forRoot(process.env.DATABASE_URL),
		SchedulerModule,
	],
	controllers: [AppController],
	providers: [
		AppService,
		ConnectDatabase,
		{ provide: APP_GUARD, useClass: JwtAuthGuard },
	],
})
export class AppModule {}
