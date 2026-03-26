import { Module } from '@nestjs/common';
import { AuthenticationService } from './authentication.service';
import { AuthenticationController } from './authentication.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from 'src/users/users.module';
import { JwtStrategy } from './authentication.strategy';
import { EmailModule } from 'src/notifications/email/email.module';
import { jwtSecret, expireKeepAliveConected } from '../env';
import { TokenBlacklistModule } from 'src/token-blacklist/token-blacklist.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';

@Module({
	imports: [
		PassportModule,
		JwtModule.register({
			secret: jwtSecret,
			signOptions: { expiresIn: expireKeepAliveConected },
			global: true,
		}),
		UsersModule,
		TokenBlacklistModule.forRoot(),
		EmailModule,
	],
	controllers: [AuthenticationController],
	providers: [
		AuthenticationService,
		JwtStrategy,
		JwtAuthGuard,
		PasswordSecurityService,
	],
	exports: [JwtAuthGuard, TokenBlacklistModule, PasswordSecurityService],
})
export class AuthenticationModule {}
