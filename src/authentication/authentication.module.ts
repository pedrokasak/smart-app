import { Module } from '@nestjs/common';
import { AuthenticationService } from './authentication.service';
import { AuthenticationController } from './authentication.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from 'src/users/users.module';
import { JwtStrategy } from './authentication.strategy';
import { EmailModule } from 'src/notifications/email/email.module';
import { appleClientIds, jwtSecret, expireKeepAliveConected } from '../env';
import { TokenBlacklistModule } from 'src/token-blacklist/token-blacklist.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';
import { BreachedPasswordModule } from 'src/authentication/breached-password.module';
import { MongoUserSessionRepository } from 'src/authentication/infrastructure/mongo-user-session.repository';
import { USER_SESSION_REPOSITORY } from 'src/authentication/session/user-session.repository';
import {
	USER_SESSION_CLOCK,
	UserSessionService,
} from 'src/authentication/session/user-session.service';
import { UserSessionsController } from 'src/authentication/session/user-sessions.controller';
import { BIOMETRIC_CREDENTIAL_REPOSITORY } from 'src/authentication/biometric/biometric-credential.repository';
import { BiometricCredentialService } from 'src/authentication/biometric/biometric-credential.service';
import { BiometricCredentialsController } from 'src/authentication/biometric/biometric-credentials.controller';
import { MongoBiometricCredentialRepository } from 'src/authentication/infrastructure/mongo-biometric-credential.repository';
import { AppleSigninController } from 'src/authentication/apple-signin.controller';
import { AppleSigninService } from 'src/authentication/application/apple-signin.service';
import { APPLE_IDENTITY_VERIFIER } from 'src/authentication/application/ports/apple-identity-verifier.port';
import {
	APPLE_AUDIENCES,
	AppleIdentityVerifierAdapter,
} from 'src/authentication/infrastructure/apple-identity-verifier.adapter';

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
		BreachedPasswordModule,
	],
	controllers: [
		AuthenticationController,
		UserSessionsController,
		AppleSigninController,
		BiometricCredentialsController,
	],
	providers: [
		AuthenticationService,
		JwtStrategy,
		JwtAuthGuard,
		PasswordSecurityService,
		UserSessionService,
		{ provide: USER_SESSION_REPOSITORY, useClass: MongoUserSessionRepository },
		{ provide: USER_SESSION_CLOCK, useValue: () => new Date() },
		BiometricCredentialService,
		{
			provide: BIOMETRIC_CREDENTIAL_REPOSITORY,
			useClass: MongoBiometricCredentialRepository,
		},
		AppleSigninService,
		{ provide: APPLE_AUDIENCES, useValue: appleClientIds },
		{
			provide: APPLE_IDENTITY_VERIFIER,
			useClass: AppleIdentityVerifierAdapter,
		},
	],
	exports: [
		AuthenticationService,
		UserSessionService,
		JwtAuthGuard,
		TokenBlacklistModule,
		PasswordSecurityService,
	],
})
export class AuthenticationModule {}
