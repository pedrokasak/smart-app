import { Injectable } from '@nestjs/common';
import { CreateSigninDto } from './dto/create-signin.dto';
import { JwtService } from '@nestjs/jwt';
import { SigninEntity } from './entities/signin.entity';
import { UserModel } from 'src/users/schema/user.model';
import * as bcrypt from 'bcrypt';
import { expireKeepAliveConected } from 'src/env';
import { AuthErrorService } from 'src/utils/erros-handler';

@Injectable()
export class SigninService {
	constructor(private jwtService: JwtService) {}

	async signin(createSigninDto: CreateSigninDto): Promise<SigninEntity> {
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
}
