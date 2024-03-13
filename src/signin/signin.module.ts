import { Module } from '@nestjs/common';
import { SigninService } from './signin.service';
import { SigninController } from './signin.controller';
import { PrismaService } from 'src/database/prisma.service';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from 'src/users/users.module';
import { JwtStrategy } from './signin.strategy';
import { UsersService } from 'src/users/users.service';

export const jwtSecret: string = process.env.JWT_SECRET;
export const expireKeepAliveConected = process.env.EXPIRES_IN;

@Module({
	imports: [
		PassportModule,
		JwtModule.register({
			secret: jwtSecret,
			signOptions: { expiresIn: expireKeepAliveConected },
		}),
		UsersModule,
	],
	controllers: [SigninController],
	providers: [SigninService, PrismaService, UsersService, JwtStrategy],
})
export class SigninModule {}
