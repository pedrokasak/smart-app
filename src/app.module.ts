import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ConnectDatabase } from './database/database.service';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { SigninModule } from './signin/signin.module';
import { ProfileModule } from './profile/profile.module';
import { PermissionsModule } from './permissions/permissions.module';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
	imports: [
		UsersModule,
		SigninModule,
		ProfileModule,
		PermissionsModule,
		MongooseModule.forRoot(process.env.DATABASE_URL),
	],
	controllers: [AppController],
	providers: [AppService, ConnectDatabase],
})
export class AppModule {}
