import {
	Injectable,
	UnauthorizedException,
	NotFoundException,
	InternalServerErrorException,
} from '@nestjs/common';
import { AuthenticateDto } from './dto/authenticate.dto';
import { JwtService } from '@nestjs/jwt';
import { AuthenticationEntity } from './entities/authentication-entity';
import { UserModel } from 'src/users/schema/user.model';
import * as bcrypt from 'bcrypt';
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

@Injectable()
export class AuthenticationService {
	constructor(
		private jwtService: JwtService,
		private tokenBlacklistService: TokenBlacklistService,
		private readonly emailService: EmailService
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

		const isPasswordValid = await bcrypt.compare(password, verifyUser.password);

		if (!isPasswordValid) {
			AuthErrorService.handleInvalidPassword();
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
		const user = await UserModel.findById(userId);

		if (!user) {
			throw new NotFoundException('User not found');
		}

		const isPasswordValid = await bcrypt.compare(
			updatePasswordDto.oldPassword,
			user.password
		);

		if (!isPasswordValid) {
			throw new UnauthorizedException('Invalid old password');
		}

		const hashedPassword = await bcrypt.hash(updatePasswordDto.newPassword, 10);

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

		// Send email
		await this.emailService.sendPasswordResetEmail(user.email, resetToken);

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
			resetPasswordExpires: { $gt: new Date() },
		}).select('+resetPasswordToken +resetPasswordExpires');

		if (!user) {
			throw new UnauthorizedException('Token inválido ou expirado');
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
			resetPasswordExpires: { $gt: new Date() },
		}).select(
			'+resetPasswordToken +resetPasswordExpires +password +twoFactorSecret'
		);

		if (!user) {
			throw new UnauthorizedException('Token inválido ou expirado');
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

		const hashedPassword = await bcrypt.hash(resetPasswordDto.newPassword, 10);

		user.password = hashedPassword;
		user.resetPasswordToken = undefined;
		user.resetPasswordExpires = undefined;
		await user.save();

		return { message: 'Senha redefinida com sucesso' };
	}
}
