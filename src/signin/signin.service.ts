import {
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import { CreateSigninDto } from './dto/create-signin.dto';
import { PrismaService } from 'src/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { SigninEntity } from './entities/signin.entity';
import { expireKeepAliveConected } from './signin.module';

@Injectable()
export class SigninService {
	constructor(
		private prisma: PrismaService,
		private jwtService: JwtService
	) {}

	async login(createSigninDto: CreateSigninDto): Promise<SigninEntity> {
		const { email, password } = createSigninDto;
		const verifyIfUserExists = await this.prisma.user.findUnique({
			where: {
				email: email,
				password: password,
			},
		});
		if (!verifyIfUserExists)
			throw new NotFoundException(`No user found for email: ${email}`);

		const isPasswordValid = verifyIfUserExists.password === password;

		if (!isPasswordValid) {
			throw new UnauthorizedException('Invalid password');
		}

		return {
			token: this.jwtService.sign({ userId: verifyIfUserExists.id }),
			expiresIn: expireKeepAliveConected,
		};
	}
}
