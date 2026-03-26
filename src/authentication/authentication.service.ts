import {
	Injectable,
	UnauthorizedException,
	NotFoundException,
	InternalServerErrorException,
	BadRequestException,
} from '@nestjs/common';
import { AuthenticateDto } from './dto/authenticate.dto';
import { JwtService } from '@nestjs/jwt';
import { AuthenticationEntity } from './entities/authentication-entity';
import { UserModel } from 'src/users/schema/user.model';
import {
	expireKeepAliveConected,
	expireKeepAliveConectedRefreshToken,
} from 'src/env';
import { AuthErrorService } from 'src/utils/errors-handler';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import * as crypto from 'crypto';
import { EmailService } from 'src/notifications/email/email.service';
import { authenticator } from 'otplib';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';

@Injectable()
export class AuthenticationService {
	constructor(
		private jwtService: JwtService,
		private tokenBlacklistService: TokenBlacklistService,
		private readonly emailService: EmailService,
		private readonly passwordSecurityService: PasswordSecurityService
	) {}

	async signin(
		createSigninDto: AuthenticateDto
	): Promise<AuthenticationEntity> {
		const { email, password } = createSigninDto;

		const verifyUser = await UserModel.findOne({ email })
			.select('+password')
			.exec();

		if (!verifyUser) {
			AuthErrorService.handleUserNotFound(email);
		}

		if (!verifyUser.password) {
			throw new InternalServerErrorException(
				'Senha não configurada para este usuário'
			);
		}

		const isPasswordValid = await this.passwordSecurityService.verifyPassword(
			password,
			verifyUser.password
		);

		if (!isPasswordValid) {
			AuthErrorService.handleInvalidPassword();
		}

		// Secure migration path: seamlessly rehash legacy bcrypt passwords using Argon2id.
		if (this.passwordSecurityService.needsRehash(verifyUser.password)) {
			verifyUser.password =
				await this.passwordSecurityService.hashPassword(password);
			await verifyUser.save();
		}

		// Se 2FA está habilitado, retorna um tempToken para verificação
		if (verifyUser.twoFactorEnabled) {
			const tempToken = this.jwtService.sign(
				{ userId: verifyUser.id, type: 'temp_2fa' },
				{ expiresIn: '5m' }
			);
			return { requiresTwoFactor: true, tempToken } as any;
		}

		const accessToken = this.jwtService.sign(
			{
				userId: verifyUser.id,
				type: 'access',
				role: verifyUser.role ?? 'user',
			},
			{ expiresIn: expireKeepAliveConected }
		);

		const refreshToken = this.jwtService.sign(
			{ userId: verifyUser.id, type: 'refresh' },
			{ expiresIn: expireKeepAliveConectedRefreshToken }
		);

		verifyUser.refreshToken = refreshToken;
		await verifyUser.save();

		return {
			accessToken: accessToken,
			refreshToken,
			expiresIn: expireKeepAliveConected,
			user: {
				id: verifyUser.id,
				email: verifyUser.email,
				firstName: verifyUser.firstName,
				lastName: verifyUser.lastName,
			},
		};
	}

	async signout(token: string) {
		const verifyToken = this.jwtService.verify(token, {
			ignoreExpiration: true,
		});
		if (!verifyToken) {
			AuthErrorService.handleInvalidToken();
		}
		await this.tokenBlacklistService.addToBlacklist(token, verifyToken.exp);

		return { message: 'Signout successfully' };
	}

	async signoutAll(userId: string) {
		const user = await UserModel.findById(userId);
		if (user) {
			user.refreshToken = null;
			await user.save();
		}

		return { message: 'All sessions signed out successfully' };
	}

	async refreshAccessToken(
		refreshToken: string
	): Promise<{ accessToken: string; expiresIn: string }> {
		try {
			const payload = this.jwtService.verify(refreshToken);

			if (payload.type !== 'refresh') {
				throw new Error('Invalid token type');
			}

			const user = await UserModel.findById(payload.userId);
			if (!user || user.refreshToken !== refreshToken) {
				throw new Error('Invalid refresh token');
			}

			const newAccessToken = this.jwtService.sign(
				{ userId: user.id, type: 'access', role: user.role ?? 'user' },
				{ expiresIn: expireKeepAliveConected }
			);

			return {
				accessToken: newAccessToken,
				expiresIn: expireKeepAliveConected,
			};
		} catch (error) {
			throw new UnauthorizedException('Invalid or expired refresh token');
		}
	}

	async updatePassword(
		userId: string,
		updatePasswordDto: UpdatePasswordDto
	): Promise<{ message: string }> {
		const user = await UserModel.findById(userId).select('+password');

		if (!user) {
			throw new NotFoundException('User not found');
		}
		if (!user.password) {
			throw new InternalServerErrorException(
				'Senha não configurada para este usuário'
			);
		}

		const isPasswordValid = await this.passwordSecurityService.verifyPassword(
			updatePasswordDto.oldPassword,
			user.password
		);

		if (!isPasswordValid) {
			throw new UnauthorizedException('Invalid old password');
		}

		const hashedPassword = await this.passwordSecurityService.hashPassword(
			updatePasswordDto.newPassword
		);

		user.password = hashedPassword;
		await user.save();

		return { message: 'Password updated successfully' };
	}

	async forgotPassword(
		forgotPasswordDto: ForgotPasswordDto
	): Promise<{ message: string }> {
		const user = await UserModel.findOne({ email: forgotPasswordDto.email });

		if (!user) {
			// Do not reveal that a user does not exist
			return {
				message: 'If the email is valid, a password reset link has been sent',
			};
		}

		// Generate token
		const resetToken = crypto.randomBytes(32).toString('hex');
		const hash = crypto.createHash('sha256').update(resetToken).digest('hex');

		// Set expiration (1 hour)
		const resetPasswordExpires = new Date();
		resetPasswordExpires.setHours(resetPasswordExpires.getHours() + 1);

		user.resetPasswordToken = hash;
		user.resetPasswordExpires = resetPasswordExpires;
		await user.save();

		// Send email (safe fallback: avoid exposing provider failures to users)
		try {
			await this.emailService.sendPasswordResetEmail(user.email, resetToken);
		} catch (_error) {
			// Keep deterministic generic response to avoid user/email enumeration.
		}

		return {
			message: 'If the email is valid, a password reset link has been sent',
		};
	}

	async verifyResetToken(
		token: string
	): Promise<{ valid: boolean; requiresMfa: boolean }> {
		const hash = crypto.createHash('sha256').update(token).digest('hex');

		const user = await UserModel.findOne({
			resetPasswordToken: hash,
		}).select('+resetPasswordToken +resetPasswordExpires +twoFactorEnabled');

		if (!user) {
			throw new UnauthorizedException('Token inválido');
		}

		if (!user.resetPasswordExpires || user.resetPasswordExpires <= new Date()) {
			throw new UnauthorizedException('Token expirado');
		}

		return { valid: true, requiresMfa: user.twoFactorEnabled };
	}

	async resetPassword(
		resetPasswordDto: ResetPasswordDto
	): Promise<{ message: string }> {
		const hash = crypto
			.createHash('sha256')
			.update(resetPasswordDto.token)
			.digest('hex');

		const user = await UserModel.findOne({
			resetPasswordToken: hash,
		}).select(
			'+resetPasswordToken +resetPasswordExpires +password +twoFactorSecret'
		);

		if (!user) {
			throw new UnauthorizedException('Token inválido');
		}

		if (!user.resetPasswordExpires || user.resetPasswordExpires <= new Date()) {
			throw new UnauthorizedException('Token expirado');
		}

		if (resetPasswordDto.newPassword !== resetPasswordDto.confirmPassword) {
			throw new BadRequestException('As senhas não correspondem');
		}

		// Verify MFA if enabled
		if (user.twoFactorEnabled) {
			if (!resetPasswordDto.tfCode) {
				throw new UnauthorizedException(
					'Código de autenticação de dois fatores é obrigatório'
				);
			}

			const isCodeValid = authenticator.verify({
				token: resetPasswordDto.tfCode,
				secret: user.twoFactorSecret,
			});

			if (!isCodeValid) {
				throw new UnauthorizedException('Código de dois fatores inválido');
			}
		}

		const hashedPassword = await this.passwordSecurityService.hashPassword(
			resetPasswordDto.newPassword
		);

		user.password = hashedPassword;
		user.resetPasswordToken = undefined;
		user.resetPasswordExpires = undefined;
		await user.save();

		return { message: 'Senha redefinida com sucesso' };
	}
}
