import {
	Body,
	Controller,
	Delete,
	Get,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common';
import { TwoFactorService } from './two-factor.service';
import {
	TwoFactorAuthenticateDto,
	TwoFactorRecoveryConsumeDto,
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

	/**
	 * Gera um conjunto novo de códigos de recuperação.
	 *
	 * Exige o TOTP atual além da sessão: são chaves de bypass do segundo
	 * fator, e emiti-las só com um access token tornaria o roubo de sessão
	 * permanente.
	 */
	@UseGuards(JwtAuthGuard)
	@Post('recovery-codes/generate')
	async generateRecoveryCodes(
		@Req() req: any,
		@Body() dto: TwoFactorVerifyDto
	) {
		const userId = req.user.userId;
		return this.twoFactorService.generateRecoveryCodes(userId, dto.code);
	}

	/** Quantos códigos ainda restam. Nunca devolve código nem hash. */
	@UseGuards(JwtAuthGuard)
	@Get('recovery-codes/status')
	async recoveryCodesStatus(@Req() req: any) {
		const userId = req.user.userId;
		return this.twoFactorService.getRecoveryCodesStatus(userId);
	}

	/**
	 * Login com código de recuperação, no lugar do TOTP.
	 *
	 * Sem `JwtAuthGuard` pela mesma razão de `authenticate`: quem perdeu o
	 * autenticador ainda não tem o JWT final, só o `tempToken`.
	 */
	@Post('recovery-codes/consume')
	async consumeRecoveryCode(@Body() dto: TwoFactorRecoveryConsumeDto) {
		return this.twoFactorService.consumeRecoveryCode(
			dto.tempToken,
			dto.recoveryCode
		);
	}
}
