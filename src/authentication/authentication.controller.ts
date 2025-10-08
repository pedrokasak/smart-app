import {
	Controller,
	Post,
	Body,
	UnauthorizedException,
	Patch,
	UseGuards,
	Request,
} from '@nestjs/common';
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
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
@ApiTags('auth')
export class AuthenticationController {
	constructor(private readonly authService: AuthenticationService) {}

	@Public()
	@Post('signin')
	@ApiOkResponse({ type: AuthenticationEntity })
	signin(@Body() authSignIn: AuthenticateDto) {
		return this.authService.signin(authSignIn);
	}

	@Public()
	@Post('signout')
	@ApiOkResponse({ type: AuthenticationEntity })
	signout(@Body() authSignOut: AuthSignoutDto) {
		return this.authService.signout(authSignOut.token);
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
				expiresIn: {
					type: 'string',
					description: 'Token expiration time',
				},
			},
		},
	})
	async refreshToken(@Body() body: RefreshTokenDto) {
		const { refreshToken } = body;
		if (!refreshToken) {
			throw new UnauthorizedException('Refresh Token is required');
		}

		try {
			const result = await this.authService.refreshAccessToken(refreshToken);
			return result;
		} catch (error) {
			throw new UnauthorizedException('Invalid or Expired Refresh Token');
		}
	}

	@UseGuards(JwtAuthGuard)
	@Patch('update-password')
	@ApiOkResponse({ description: 'Password updated successfully' })
	updatePassword(@Request() req, @Body() updatePasswordDto: UpdatePasswordDto) {
		const userId = req.user.userId;
		return this.authService.updatePassword(userId, updatePasswordDto);
	}
}
