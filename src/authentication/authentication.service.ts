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

@Injectable()
export class AuthenticationService {
	constructor(
		private jwtService: JwtService,
		private tokenBlacklistService: TokenBlacklistService
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

		const accessToken = this.jwtService.sign(
			{ userId: verifyUser.id, type: 'access' },
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
				{ userId: user.id, type: 'access' },
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
}
