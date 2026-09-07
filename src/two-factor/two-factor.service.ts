import {
	BadRequestException,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { UserModel } from 'src/users/schema/user.model';
import { JwtService } from '@nestjs/jwt';
import { jwtSecret } from 'src/env';
import {
	AuthenticationService,
	SessionTokens,
	SessionUser,
} from 'src/authentication/authentication.service';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import {
	TwoFactorAttemptState,
	clearedAttemptState,
	hasReachedLimit,
	isTwoFactorBlocked,
	readAttemptState,
	registerFailedAttempt,
} from './security/two-factor-attempt-policy';

@Injectable()
export class TwoFactorService {
	constructor(
		private jwtService: JwtService,
		private readonly authenticationService: AuthenticationService,
		private readonly tokenBlacklistService: TokenBlacklistService
	) {}

	/**
	 * Gera um segredo TOTP para o usuário e retorna a URL do QR Code em base64.
	 * O segredo não é salvo ainda — só é salvo quando o usuário verificar o código.
	 */
	async setupTwoFactor(
		userId: string
	): Promise<{ secret: string; qrCodeDataUrl: string }> {
		const user = await UserModel.findById(userId);
		if (!user) throw new BadRequestException('Usuário não encontrado.');

		const secret = authenticator.generateSecret();
		const appName = 'Trackerr';
		const otpAuthUrl = authenticator.keyuri(user.email, appName, secret);
		const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);

		// Salva o segredo temporariamente (confirmação só após verify)
		await UserModel.findByIdAndUpdate(userId, {
			$set: { twoFactorSecret: secret, twoFactorEnabled: false },
		});

		return { secret, qrCodeDataUrl };
	}

	/**
	 * Verifica o código TOTP e habilita o 2FA para o usuário.
	 */
	async enableTwoFactor(
		userId: string,
		code: string
	): Promise<{ message: string }> {
		const user = await UserModel.findById(userId).select('+twoFactorSecret');
		if (!user || !user.twoFactorSecret) {
			throw new BadRequestException('Configure o 2FA primeiro.');
		}

		const isValid = authenticator.verify({
			token: code,
			secret: user.twoFactorSecret,
		});

		if (!isValid) {
			throw new UnauthorizedException('Código inválido ou expirado.');
		}

		await UserModel.findByIdAndUpdate(userId, { twoFactorEnabled: true });
		return { message: '2FA habilitado com sucesso!' };
	}

	/**
	 * Desabilita o 2FA do usuário após validar o código atual.
	 */
	async disableTwoFactor(
		userId: string,
		code: string
	): Promise<{ message: string }> {
		const user = await UserModel.findById(userId).select('+twoFactorSecret');
		if (!user || !user.twoFactorSecret || !user.twoFactorEnabled) {
			throw new BadRequestException('2FA não está habilitado.');
		}

		const isValid = authenticator.verify({
			token: code,
			secret: user.twoFactorSecret,
		});

		if (!isValid) {
			throw new UnauthorizedException('Código inválido ou expirado.');
		}

		await UserModel.findByIdAndUpdate(userId, {
			twoFactorEnabled: false,
			twoFactorSecret: null,
		});
		return { message: '2FA desabilitado com sucesso.' };
	}

	/**
	 * Autentica o código TOTP pós-login (quando 2FA está habilitado).
	 * Recebe o tempToken + código e emite a sessão final.
	 *
	 * A emissão é delegada a `AuthenticationService.issueSessionTokens`
	 * (TRA-140): é o mesmo caminho do login sem 2FA, então o refresh token sai
	 * daqui hasheado em SHA-256 como qualquer outro e o access token carrega o
	 * `role`. Antes este método assinava e gravava os tokens sozinho, e a cópia
	 * gravava `user.refreshToken` em texto puro — um bearer legível no banco
	 * que, ainda por cima, nunca casava com o verificador de `refreshAccessToken`.
	 */
	async authenticateWithTwoFactor(
		tempToken: string,
		code: string
	): Promise<SessionTokens> {
		let payload: { userId: string; type: string; exp?: number };
		try {
			payload = this.jwtService.verify(tempToken, { secret: jwtSecret }) as any;
		} catch {
			throw new UnauthorizedException('Token temporário inválido ou expirado.');
		}

		if (payload.type !== 'temp_2fa') {
			throw new UnauthorizedException('Token inválido.');
		}

		// Um tempToken revogado por excesso de tentativas nao volta a valer so
		// porque ainda nao expirou. Mesma mensagem do token invalido: quem
		// tenta reusar nao aprende nada com a resposta.
		if (await this.tokenBlacklistService.isBlacklisted(tempToken)) {
			throw new UnauthorizedException('Token temporário inválido ou expirado.');
		}

		const user = await UserModel.findById(payload.userId).select(
			'+twoFactorSecret +twoFactorFailedAttempts +twoFactorFirstFailedAttemptAt'
		);
		if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
			throw new BadRequestException('2FA não configurado para este usuário.');
		}

		const now = new Date();
		const attemptState = readAttemptState(user);

		// Bloqueio conferido ANTES de validar o codigo: validar primeiro
		// devolveria ao atacante a informacao que o bloqueio existe para negar.
		if (isTwoFactorBlocked(attemptState, now)) {
			await this.revokeTempToken(tempToken, payload.exp);
			throw new UnauthorizedException(
				'Muitas tentativas de verificação. Faça login novamente.'
			);
		}

		const isValid = authenticator.verify({
			token: code,
			secret: user.twoFactorSecret,
		});

		if (!isValid) {
			const nextState = registerFailedAttempt(attemptState, now);
			await this.persistAttemptState(user.id, nextState);

			if (hasReachedLimit(nextState)) {
				await this.revokeTempToken(tempToken, payload.exp);
				throw new UnauthorizedException(
					'Muitas tentativas de verificação. Faça login novamente.'
				);
			}

			throw new UnauthorizedException('Código 2FA inválido ou expirado.');
		}

		// Acerto zera a contagem: a janela existe para conter automacao, nao
		// para punir quem digitou errado uma vez e acertou depois.
		await this.persistAttemptState(user.id, clearedAttemptState());

		return this.authenticationService.issueSessionTokens(
			user as unknown as SessionUser
		);
	}

	/**
	 * Grava a contagem de tentativas com `updateOne` em vez de mexer no
	 * documento carregado: `issueSessionTokens` faz o proprio `save()` logo em
	 * seguida no caminho de sucesso, e um `save()` extra aqui competiria com
	 * ele pela versao do documento.
	 */
	private async persistAttemptState(
		userId: string,
		state: TwoFactorAttemptState
	): Promise<void> {
		await UserModel.updateOne(
			{ _id: userId },
			{
				$set: {
					twoFactorFailedAttempts: state.failedAttempts,
					twoFactorFirstFailedAttemptAt: state.firstFailedAttemptAt,
				},
			}
		).exec();
	}

	/**
	 * Revoga o tempToken reaproveitando a blacklist que ja existe para os
	 * access tokens — mesmo mecanismo, mesma colecao com TTL, nenhuma
	 * dependencia nova. Sem `exp` no payload nao ha o que revogar de forma
	 * limpa, e a contagem por usuario ja segura a tentativa seguinte.
	 */
	private async revokeTempToken(
		tempToken: string,
		exp?: number
	): Promise<void> {
		if (!exp) {
			return;
		}

		await this.tokenBlacklistService.addToBlacklist(tempToken, exp);
	}

	/**
	 * Verifica se o código TOTP é válido sem alterar o estado (usado internamente).
	 */
	isCodeValid(code: string, secret: string): boolean {
		return authenticator.verify({ token: code, secret });
	}
}
