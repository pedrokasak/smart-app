import { Controller, Post, Body } from '@nestjs/common';
import { CreateSigninDto } from './dto/create-signin.dto';
import { SigninService } from './signin.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SigninEntity } from './entities/signin.entity';

@Controller('auth')
@ApiTags('auth')
export class SigninController {
	constructor(private readonly authService: SigninService) {}

	@Post('login')
	@ApiOkResponse({ type: SigninEntity })
	login(@Body() authSignIn: CreateSigninDto) {
		return this.authService.login(authSignIn);
	}
}
