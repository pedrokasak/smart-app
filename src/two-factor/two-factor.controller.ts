import { Body, Controller, Delete, Post, Req, UseGuards } from '@nestjs/common';
import { TwoFactorService } from './two-factor.service';
import {
	TwoFactorAuthenticateDto,
	TwoFactorVerifyDto,
} from './dto/two-factor.dto';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';

@Controller('auth/2fa')
export class TwoFactorController {
	constructor(private readonly twoFactorService: TwoFactorService) {}

	/** Gera QR Code para configurar o autenticador */
	@UseGuards(JwtAuthGuard)
	@Post('setup')
	async setup(@Req() req: any) {
		const userId = req.user.userId;
		return this.twoFactorService.setupTwoFactor(userId);
	}

	/** Valida o código do autenticador e habilita o 2FA */
	@UseGuards(JwtAuthGuard)
	@Post('verify')
	async verify(@Req() req: any, @Body() dto: TwoFactorVerifyDto) {
		const userId = req.user.userId;
		return this.twoFactorService.enableTwoFactor(userId, dto.code);
	}

	/** Desabilita o 2FA (requer código atual) */
	@UseGuards(JwtAuthGuard)
	@Delete('disable')
	async disable(@Req() req: any, @Body() dto: TwoFactorVerifyDto) {
		const userId = req.user.userId;
		return this.twoFactorService.disableTwoFactor(userId, dto.code);
	}

	/**
	 * Autenticação pós-login com 2FA.
	 * Não requer JwtAuthGuard pois o usuário ainda não tem o JWT final.
	 */
	@Post('authenticate')
	async authenticate(@Body() dto: TwoFactorAuthenticateDto) {
		return this.twoFactorService.authenticateWithTwoFactor(
			dto.tempToken,
			dto.code
		);
	}
}
