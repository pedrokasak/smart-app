import { Module } from '@nestjs/common';
import { SigninService } from './signin.service';
import { SigninController } from './signin.controller';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from 'src/users/users.module';
import { JwtStrategy } from './signin.strategy';
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
	controllers: [SigninController],
	providers: [SigninService, UsersService, JwtStrategy],
})
export class SigninModule {}
