import {
	BadRequestException,
	HttpException,
	HttpStatus,
	Injectable,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import { UserModel } from '../users/schema/user.model';
import { AuthErrorService } from '../utils/errors-handler';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class UsersService {
	constructor(private readonly jwtService: JwtService) {}
	async create(createUserDto: CreateUserDto) {
		try {
			const { firstName, lastName, email, password, confirmPassword } =
				createUserDto;

			const verifyIsEmailExists = await UserModel.findOne({
				email,
			});
			if (verifyIsEmailExists)
				throw new BadRequestException(`Email ${email} already exists`);

			if (password !== confirmPassword) {
				throw AuthErrorService.handleInvalidConfirmPassword();
			}

			const saltRounds = 10;
			const hashedPassword = await bcrypt.hash(password, saltRounds);

			const newUser = new UserModel({
				firstName,
				lastName,
				email,
				password: hashedPassword,
			});

			await newUser.save();

			// Gera o token JWT
			const payload = { sub: newUser._id, email: newUser.email };
			const accessToken = this.jwtService.sign(payload);

			return {
				message: 'User created successfully',
				user: {
					_id: newUser._id,
					firstName: newUser.firstName,
					lastName: newUser.lastName,
					email: newUser.email,
					// Retorna o token JWT
				},
				accessToken,
			};
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
		return await UserModel.find();
	}

	async findOne(id: string) {
		return await UserModel.findById(id);
	}

	async findByEmail(email: string) {
		return await UserModel.findOne({ email });
	}

	async findByCpf(cpf: string) {
		return await UserModel.findOne({ cpf });
	}

	async update(id: string, updateUserDto: UpdateUserDto) {
		return await UserModel.findByIdAndUpdate(id, updateUserDto, { new: true });
	}

	async delete(id: string) {
		return await UserModel.findByIdAndDelete(id);
	}
}
