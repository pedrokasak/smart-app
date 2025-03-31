import { Injectable } from '@nestjs/common';
import { AuthenticateDto } from './dto/authenticate.dto';
import { JwtService } from '@nestjs/jwt';
import { AuthenticationEntity } from './entities/authentication-entity';
import { UserModel } from 'src/users/schema/user.model';
import * as bcrypt from 'bcrypt';
import { expireKeepAliveConected } from 'src/env';
import { AuthErrorService } from 'src/utils/erros-handler';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';

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

		const verifyUser = await UserModel.findOne({ email }).exec();

		if (!verifyUser) {
			AuthErrorService.handleUserNotFound(email);
		}

		const isPasswordValid = await bcrypt.compare(password, verifyUser.password);

		if (!isPasswordValid) {
			AuthErrorService.handleInvalidPassword();
		}

		return {
			token: this.jwtService.sign({ userId: verifyUser.id }),
			expiresIn: expireKeepAliveConected,
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
}
