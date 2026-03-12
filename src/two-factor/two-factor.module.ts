import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { jwtSecret } from 'src/env';

@Module({
	imports: [
		JwtModule.register({
			secret: jwtSecret,
		}),
	],
	controllers: [TwoFactorController],
	providers: [TwoFactorService],
	exports: [TwoFactorService],
})
export class TwoFactorModule {}
