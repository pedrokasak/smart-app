import {
	Controller,
	Post,
	Body,
	UseGuards,
	UnauthorizedException,
} from '@nestjs/common';
import { AuthenticateDto, AuthSignoutDto } from './dto/authenticate.dto';
import { AuthenticationService } from './authentication.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticationEntity } from './entities/authentication-entity';

import { Public } from 'src/utils/constants';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UserModel } from 'src/users/schema/user.model';
import { JwtService } from '@nestjs/jwt';

@Controller('auth')
@ApiTags('auth')
export class AuthenticationController {
	constructor(
		private readonly authService: AuthenticationService,
		private readonly jwtService: JwtService
	) {}

	@Public()
	@Post('signin')
	@ApiOkResponse({ type: AuthenticationEntity })
	signin(@Body() authSignIn: AuthenticateDto) {
		return this.authService.signin(authSignIn);
	}

	@Post('signout')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: AuthenticationEntity })
	signout(@Body() authSignOut: AuthSignoutDto) {
		return this.authService.signout(authSignOut.token);
	}

	@Post('refresh-token')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: AuthenticationEntity })
	async refreshToken(@Body() body: { refreshToken: string }) {
		const { refreshToken } = body;
		if (!refreshToken) {
			throw new UnauthorizedException('Refresh Token is required');
		}

		try {
			// Verificar se o token é válido
			const payload = this.jwtService.verify(refreshToken);
			const user = await UserModel.findById(payload.userId);

			if (!user || user.refreshToken !== refreshToken) {
				throw new UnauthorizedException('Invalid Refresh Token');
			}

			// Criar um novo access token
			const newAccessToken = this.jwtService.sign(
				{ userId: user.id },
				{ expiresIn: '15m' }
			);

			return { accessToken: newAccessToken };
		} catch (error) {
			throw new UnauthorizedException('Invalid or Expired Refresh Token');
		}
	}
}
