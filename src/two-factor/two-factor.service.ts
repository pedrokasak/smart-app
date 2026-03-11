import {
	BadRequestException,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { UserModel } from 'src/users/schema/user.model';
import { JwtService } from '@nestjs/jwt';
import {
	jwtSecret,
	expireKeepAliveConected,
	expireKeepAliveConectedRefreshToken,
} from 'src/env';

@Injectable()
export class TwoFactorService {
	constructor(private jwtService: JwtService) {}

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
	 * Recebe o tempToken + código e emite o JWT final.
	 */
	async authenticateWithTwoFactor(
		tempToken: string,
		code: string
	): Promise<{ accessToken: string; refreshToken: string; expiresIn: string }> {
		let payload: { userId: string; type: string };
		try {
			payload = this.jwtService.verify(tempToken, { secret: jwtSecret }) as any;
		} catch {
			throw new UnauthorizedException('Token temporário inválido ou expirado.');
		}

		if (payload.type !== 'temp_2fa') {
			throw new UnauthorizedException('Token inválido.');
		}

		const user = await UserModel.findById(payload.userId).select(
			'+twoFactorSecret'
		);
		if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
			throw new BadRequestException('2FA não configurado para este usuário.');
		}

		const isValid = authenticator.verify({
			token: code,
			secret: user.twoFactorSecret,
		});

		if (!isValid) {
			throw new UnauthorizedException('Código 2FA inválido ou expirado.');
		}

		const accessToken = this.jwtService.sign(
			{ userId: user.id, type: 'access' },
			{ secret: jwtSecret, expiresIn: expireKeepAliveConected }
		);
		const refreshToken = this.jwtService.sign(
			{ userId: user.id, type: 'refresh' },
			{ secret: jwtSecret, expiresIn: expireKeepAliveConectedRefreshToken }
		);

		user.refreshToken = refreshToken;
		await user.save();

		return { accessToken, refreshToken, expiresIn: expireKeepAliveConected };
	}

	/**
	 * Verifica se o código TOTP é válido sem alterar o estado (usado internamente).
	 */
	isCodeValid(code: string, secret: string): boolean {
		return authenticator.verify({ token: code, secret });
	}
}
