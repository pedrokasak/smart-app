import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaService } from './database/prisma.service';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { SigninModule } from './signin/signin.module';

@Module({
  imports: [UsersModule, SigninModule],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
