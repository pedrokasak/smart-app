import {
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import { jwtSecret } from '../env';
import { TokenBlacklistService } from '../token-blacklist/token-blacklist.service';
import { IS_PUBLIC_KEY } from '../utils/constants';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
	constructor(
		private jwtService: JwtService,
		private reflector: Reflector,
		private tokenBlacklistService: TokenBlacklistService
	) {
		super();
		if (!this.tokenBlacklistService) {
			throw new Error(
				'TokenBlacklistService não foi injetado corretamente no JwtAuthGuard'
			);
		}
	}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass(),
		]);

		if (isPublic) {
			return true;
		}

		const request = context.switchToHttp().getRequest();
		const token = this.extractTokenFromHeader(request);

		if (!token) {
			throw new UnauthorizedException('Token não fornecido.');
		}

		const isBlacklisted = await this.tokenBlacklistService.isBlacklisted(token);
		if (isBlacklisted) {
			console.log('❌ Erro: Token está na blacklist.');
			throw new UnauthorizedException('Token inválido ou expirado.');
		}

		try {
			const payload = await this.jwtService.verifyAsync(token, {
				secret: jwtSecret,
			});
			request['user'] = payload;
		} catch (error) {
			throw new UnauthorizedException('Token inválido ou expirado.');
		}

		return true;
	}

	private extractTokenFromHeader(request: Request): string | undefined {
		// console.log(request.headers['authorization']);
		const [type, token] = request.headers['authorization']?.split(' ') ?? [];
		return type === 'Bearer' ? token : undefined;
	}
}
