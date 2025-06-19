//src/auth/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { jwtSecret } from 'src/env';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
	constructor(private usersService: UsersService) {
		super({
			jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
			secretOrKey: jwtSecret,
		});
	}

	async validate(payload: { userId: string; type: string }) {
		// Verificar se é um access token
		if (payload.type !== 'access') {
			throw new UnauthorizedException('Invalid token type');
		}

		const user = this.usersService.findOne(payload.userId);

		if (!user) {
			throw new UnauthorizedException();
		}

		return user;
	}
}
