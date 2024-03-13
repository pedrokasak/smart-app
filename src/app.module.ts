import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaService } from './database/prisma.service';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { SigninModule } from './signin/signin.module';
import { ProfileModule } from './profile/profile.module';

@Module({
	imports: [UsersModule, SigninModule, ProfileModule],
	controllers: [AppController],
	providers: [AppService, PrismaService],
})
export class AppModule {}
