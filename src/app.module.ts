import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaService } from './database/prisma.service';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { SigninModule } from './signin/signin.module';
import { ProfileModule } from './profile/profile.module';
import { PermissionsModule } from './permissions/permissions.module';
import { KafkaController } from './listener/kafkaController';

@Module({
	imports: [
		UsersModule,
		SigninModule,
		ProfileModule,
		PermissionsModule,
		KafkaController,
	],
	controllers: [AppController],
	providers: [AppService, PrismaService],
})
export class AppModule {}
