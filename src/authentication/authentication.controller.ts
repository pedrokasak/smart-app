import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthenticateDto, AuthSignoutDto } from './dto/authenticate.dto';
import { AuthenticationService } from './authentication.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticationEntity } from './entities/authentication-entity';

import { Public } from 'src/utils/constants';
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

	@Post('signout')
	@UseGuards(JwtAuthGuard)
	@ApiOkResponse({ type: AuthenticationEntity })
	signout(@Body() authSignOut: AuthSignoutDto) {
		return this.authService.signout(authSignOut.token);
	}
}
