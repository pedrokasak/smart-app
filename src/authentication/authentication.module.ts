import { Module } from '@nestjs/common';
import { AuthenticationService } from './authentication.service';
import { AuthenticationController } from './authentication.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from 'src/users/users.module';
import { JwtStrategy } from './authentication.strategy';
import { UsersService } from 'src/users/users.service';
import { jwtSecret, expireKeepAliveConected } from '../env';

@Module({
	imports: [
		PassportModule,
		JwtModule.register({
			secret: jwtSecret,
			signOptions: { expiresIn: expireKeepAliveConected },
		}),
		UsersModule,
	],
	controllers: [AuthenticationController],
	providers: [AuthenticationService, UsersService, JwtStrategy],
})
export class AuthenticateModule {}
