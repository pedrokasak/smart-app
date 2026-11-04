import {
	Body,
	Controller,
	Delete,
	HttpCode,
	Param,
	Post,
	Request,
	UseGuards,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiNoContentResponse,
	ApiOkResponse,
	ApiTags,
} from '@nestjs/swagger';
import { OwnershipChecked } from 'src/auth/decorators/ownership.decorator';
import {
	BiometricCredentialResponseDto,
	BiometricSigninDto,
	EnrollBiometricCredentialDto,
} from 'src/authentication/dto/biometric-credential.dto';
import { AuthenticationEntity } from 'src/authentication/entities/authentication-entity';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { Public } from 'src/utils/constants';
import { BiometricCredentialService } from './biometric-credential.service';

@Controller('auth/biometric')
@ApiTags('authentication')
export class BiometricCredentialsController {
	constructor(private readonly credentials: BiometricCredentialService) {}

	@Public()
	@Post('signin')
	@ApiOkResponse({ type: AuthenticationEntity })
	signin(@Body() payload: BiometricSigninDto) {
		return this.credentials.signin(payload.credential, payload.device);
	}

	@Post('credentials')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth('access-token')
	@ApiOkResponse({ type: BiometricCredentialResponseDto })
	async enroll(
		@Request() req,
		@Body() payload: EnrollBiometricCredentialDto
	): Promise<BiometricCredentialResponseDto> {
		const credential = await this.credentials.enroll(
			req.user.userId,
			payload.device
		);
		return { credential };
	}

	@Delete('credentials/:deviceId')
	@UseGuards(JwtAuthGuard)
	@ApiBearerAuth('access-token')
	@OwnershipChecked(
		'BiometricCredentialService.revoke filtra o aparelho pelo userId do token'
	)
	@HttpCode(204)
	@ApiNoContentResponse({ description: 'Biometria desligada no aparelho' })
	async revoke(
		@Request() req,
		@Param('deviceId') deviceId: string
	): Promise<void> {
		await this.credentials.revoke(req.user.userId, deviceId);
	}
}
