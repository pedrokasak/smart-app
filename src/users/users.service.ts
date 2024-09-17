import {
	BadRequestException,
	HttpException,
	HttpStatus,
	Injectable,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import { UserModel } from './schema/user.model';

@Injectable()
export class UsersService {
	async create(createUserDto: CreateUserDto) {
		try {
			const { firstName, lastName, email, password } = createUserDto;

			const verifyIsEmailExists = await UserModel.findOne({
				email,
			});
			if (verifyIsEmailExists)
				throw new BadRequestException(`Email ${email} already exists`);

			const saltRounds = 10;
			const hashedPassword = await bcrypt.hash(password, saltRounds);

			const newUser = new UserModel({
				firstName,
				lastName,
				email,
				password: hashedPassword,
			});

			await newUser.save();

			return { message: 'User created successfully', user: newUser };
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

	async update(id: string, updateUserDto: UpdateUserDto) {
		return await UserModel.findByIdAndUpdate(id, updateUserDto, { new: true });
	}

	async delete(id: string) {
		return await UserModel.findByIdAndDelete(id);
	}
}
