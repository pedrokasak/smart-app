import {
	BadRequestException,
	HttpException,
	HttpStatus,
	Injectable,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { PrismaService } from 'src/database/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
	constructor(private readonly prisma: PrismaService) {}

	async create(createUserDto: CreateUserDto) {
		try {
			const { first_name, last_name, email, password } = createUserDto;

			const verifyIsEmailExists = await this.prisma.user.findUnique({
				where: {
					email: email,
				},
			});
			if (verifyIsEmailExists)
				throw new BadRequestException(`Email ${email} already exists`);

			const saltRounds = 10;
			const hashedPassword = await bcrypt.hash(password, saltRounds);

			// if (password)
			// 	throw new BadRequestException(
			// 		'Password is a different de repeat password'
			// 	);

			await this.prisma.user.create({
				data: {
					first_name,
					last_name,
					email,
					password: hashedPassword,
				},
			});
			return createUserDto;
		} catch (error) {
			throw new HttpException(
				{
					status: HttpStatus.BAD_REQUEST,
					error: error.message,
				},
				HttpStatus.BAD_REQUEST
			);
		}
	}

	async findMany() {
		return await this.prisma.user.findMany();
	}

	async findOne(id: string) {
		const data = await this.prisma.user.findUnique({
			where: {
				id,
			},
		});

		return data;
	}

	async update(id: string, updateUserDto: UpdateUserDto) {
		const response = await this.prisma.user.update({
			where: {
				id,
			},
			data: {
				...updateUserDto,
			},
		});

		return response;
	}

	async delete(id: string) {
		const response = await this.prisma.user.delete({
			where: {
				id,
			},
		});
		return response;
	}
}
