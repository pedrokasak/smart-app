import { Module } from '@nestjs/common';
import { AuthenticationService } from './authentication.service';
import { AuthenticationController } from './authentication.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from 'src/users/users.module';
import { JwtStrategy } from './authentication.strategy';
import { UsersService } from 'src/users/users.service';
import { jwtSecret, expireKeepAliveConected } from '../env';
import { TokenBlacklistModule } from 'src/token-blacklist/token-blacklist.module';
import { JwtAuthGuard } from './jwt-auth.guard';

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
	],
	controllers: [AuthenticationController],
	providers: [AuthenticationService, UsersService, JwtStrategy, JwtAuthGuard],
	exports: [JwtAuthGuard, TokenBlacklistModule],
})
export class AuthenticationModule {}
