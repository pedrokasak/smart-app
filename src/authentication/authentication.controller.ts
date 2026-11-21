import {
	Controller,
	Post,
	Body,
	UnauthorizedException,
	Patch,
	UseGuards,
	Request,
	Res,
	Get,
	Param,
} from '@nestjs/common';
import type { Response } from 'express';
import {
	AuthenticateDto,
	AuthSignoutDto,
	RefreshTokenDto,
} from './dto/authenticate.dto';
import { AuthenticationService } from './authentication.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticationEntity } from './entities/authentication-entity';

import { Public } from 'src/utils/constants';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleSigninDto } from 'src/authentication/dto/google-signin.dto';
import {
	REFRESH_TOKEN_COOKIE,
	clearRefreshTokenCookie,
	setRefreshTokenCookie,
} from './refresh-token-cookie';

@Controller('auth')
@ApiTags('authentication')
export class AuthenticationController {
	constructor(private readonly authService: AuthenticationService) {}

	@Public()
	@Post('signin')
	@ApiOkResponse({ type: AuthenticationEntity })
	async signin(
		@Body() authSignIn: AuthenticateDto,
		@Res({ passthrough: true }) res: Response
	) {
		const result = await this.authService.signin(authSignIn);
		// TRA-217: cookie httpOnly é a fonte nova; o refreshToken continua no
		// body por uma janela de transição, para o cliente web em cache.
		if (result.refreshToken && result.refreshTokenExpiresAt) {
			setRefreshTokenCookie(
				res,
				result.refreshToken,
				result.refreshTokenExpiresAt.getTime()
			);
		}
		return result;
	}

	@Public()
	@Post('google/signin')
	@ApiOkResponse({ type: AuthenticationEntity })
	async signinWithGoogle(
		@Body() payload: GoogleSigninDto,
		@Res({ passthrough: true }) res: Response
	) {
		const result = await this.authService.googleSignin(payload);
		if (result.refreshToken && result.refreshTokenExpiresAt) {
			setRefreshTokenCookie(
				res,
				result.refreshToken,
				result.refreshTokenExpiresAt.getTime()
			);
		}
		return result;
	}

	@Public()
	@Post('signout')
	@ApiOkResponse({ type: AuthenticationEntity })
	async signout(
		@Body() authSignOut: AuthSignoutDto,
		@Request() req,
		@Res({ passthrough: true }) res: Response
	) {
		// TRA-217: cliente novo não manda mais o token no body, ele vem do
		// cookie httpOnly. Aceita o body ainda pelo cliente antigo em cache.
		const token = req.cookies?.[REFRESH_TOKEN_COOKIE] || authSignOut.token;
		clearRefreshTokenCookie(res);
		if (!token) {
			return { message: 'Signout successfully' };
		}
		return this.authService.signout(token);
	}

	@Public()
	@Post('refresh-token')
	@ApiOkResponse({
		description: 'Renew access token using refresh token',
		schema: {
			type: 'object',
			properties: {
				accessToken: {
					type: 'string',
					description: 'New access token',
				},
				refreshToken: {
					type: 'string',
					description:
						'New refresh token (rotated). Replaces the previous one; absent when a concurrent request already rotated it.',
				},
				expiresIn: {
					type: 'string',
					description: 'Token expiration time',
				},
			},
		},
	})
	async refreshToken(
		@Body() body: RefreshTokenDto,
		@Request() req,
		@Res({ passthrough: true }) res: Response
	) {
		// TRA-217: cookie httpOnly é a fonte preferida; body.refreshToken é
		// fallback só pelo cliente web antigo em cache durante a transição.
		const refreshToken =
			req.cookies?.[REFRESH_TOKEN_COOKIE] || body.refreshToken;
		if (!refreshToken) {
			throw new UnauthorizedException('Refresh Token is required');
		}

		const result = await this.authService.refreshAccessToken(refreshToken);
		setRefreshTokenCookie(
			res,
			result.refreshToken ?? refreshToken,
			result.refreshTokenExpiresAt.getTime()
		);
		return result;
	}

	@UseGuards(JwtAuthGuard)
	@Patch('update-password')
	@ApiOkResponse({ description: 'Password updated successfully' })
	updatePassword(@Request() req, @Body() updatePasswordDto: UpdatePasswordDto) {
		const userId = req.user.userId;
		return this.authService.updatePassword(userId, updatePasswordDto);
	}

	@Public()
	@Post('forgot-password')
	@ApiOkResponse({ description: 'Password reset email sent (if email exists)' })
	forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
		return this.authService.forgotPassword(forgotPasswordDto);
	}

	@Public()
	@Get('reset-password/:token')
	@ApiOkResponse({ description: 'Verify token and check MFA requirements' })
	verifyResetToken(@Param('token') token: string) {
		return this.authService.verifyResetToken(token);
	}

	@Public()
	@Post('reset-password')
	@ApiOkResponse({ description: 'Password successfully reset' })
	resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
		return this.authService.resetPassword(resetPasswordDto);
	}
}
