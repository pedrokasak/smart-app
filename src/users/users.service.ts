import {
	BadRequestException,
	HttpException,
	HttpStatus,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import { UserModel } from '../users/schema/user.model';
import { AuthErrorService } from '../utils/errors-handler';
import { JwtService } from '@nestjs/jwt';
import { Role } from 'src/auth/enums/role.enum';

@Injectable()
export class UsersService {
	constructor(private readonly jwtService: JwtService) {}
	async create(createUserDto: CreateUserDto) {
		try {
			const { firstName, lastName, email, password, confirmPassword, cpf } =
				createUserDto;

			const verifyIsEmailExists = await UserModel.findOne({
				email,
			});
			if (verifyIsEmailExists)
				throw new BadRequestException(`Email ${email} already exists`);

			const verifyIsCpfExists = await UserModel.findOne({
				cpf,
			});
			if (verifyIsCpfExists)
				throw new BadRequestException(`CPF ${cpf} already exists`);

			if (password !== confirmPassword) {
				throw AuthErrorService.handleInvalidConfirmPassword();
			}

			const saltRounds = 10;
			const hashedPassword = await bcrypt.hash(password, saltRounds);

			const newUser = new UserModel({
				firstName,
				lastName,
				email,
				cpf,
				password: hashedPassword,
			});

			await newUser.save();

			// Gera o token JWT com o formato aceito pelo JwtStrategy
			const payload = { userId: newUser.id, type: 'access' };
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

	async updateUserRole(id: string, role: Role) {
		const user = await UserModel.findById(id);
		if (!user) throw new NotFoundException('Usuário não encontrado');
		if (!Object.values(Role).includes(role)) {
			throw new BadRequestException(
				`Role inválido: ${role}. Use: ${Object.values(Role).join(', ')}`
			);
		}
		user.role = role;
		await user.save();
		return {
			message: `Role atualizado para '${role}' com sucesso`,
			userId: id,
			role,
		};
	}
}
