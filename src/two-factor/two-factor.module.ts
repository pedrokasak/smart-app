import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { jwtSecret } from 'src/env';
import { AuthenticationModule } from 'src/authentication/authentication.module';

@Module({
	imports: [
		JwtModule.register({
			secret: jwtSecret,
		}),
		// Traz `AuthenticationService` para reaproveitar `issueSessionTokens`
		// (TRA-140). `AuthenticationModule` não importa este módulo, então não
		// há ciclo.
		AuthenticationModule,
	],
	controllers: [TwoFactorController],
	providers: [TwoFactorService],
	exports: [TwoFactorService],
})
export class TwoFactorModule {}
