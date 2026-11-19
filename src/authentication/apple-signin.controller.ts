import { Body, Controller, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/utils/constants';
import { AppleSigninService } from './application/apple-signin.service';
import { AppleSigninDto } from './dto/apple-signin.dto';
import { AuthenticationEntity } from './entities/authentication-entity';

@Controller('auth')
@ApiTags('authentication')
export class AppleSigninController {
	constructor(private readonly appleSignin: AppleSigninService) {}

	@Public()
	@Post('apple/signin')
	@ApiOkResponse({ type: AuthenticationEntity })
	signin(@Body() payload: AppleSigninDto) {
		return this.appleSignin.signin(payload);
	}
}
