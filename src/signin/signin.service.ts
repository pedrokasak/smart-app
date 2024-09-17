import {
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import { CreateSigninDto } from './dto/create-signin.dto';
import { JwtService } from '@nestjs/jwt';
import { SigninEntity } from './entities/signin.entity';
import { UserModel } from 'src/users/schema/user.model';
import * as bcrypt from 'bcrypt';
import { expireKeepAliveConected } from 'src/env';

@Injectable()
export class SigninService {
	constructor(private jwtService: JwtService) {}

	async signin(createSigninDto: CreateSigninDto): Promise<SigninEntity> {
		const { email, password } = createSigninDto;

		const verifyUser = await UserModel.findOne({
			email,
		}).exec();

		if (!verifyUser)
			throw new NotFoundException(`No user found for email: ${email}`);

		const isPasswordValid = await bcrypt.compare(password, verifyUser.password);

		if (!isPasswordValid) {
			throw new UnauthorizedException('Invalid password');
		}

		return {
			token: this.jwtService.sign({ userId: verifyUser.id }),
			expiresIn: expireKeepAliveConected,
		};
	}
}
