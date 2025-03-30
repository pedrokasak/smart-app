import { Controller, Post, Body } from '@nestjs/common';
import { CreateSigninDto } from './dto/create-signin.dto';
import { AuthenticationService } from './authentication.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticationEntity } from './entities/authentication-entity';

@Controller('auth')
@ApiTags('auth')
export class AuthenticationController {
	constructor(private readonly authService: AuthenticationService) {}

	@Post('signin')
	@ApiOkResponse({ type: AuthenticationEntity })
	signin(@Body() authSignIn: CreateSigninDto) {
		return this.authService.signin(authSignIn);
	}
}
