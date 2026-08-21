import {
	BadRequestException,
	HttpException,
	Inject,
	HttpStatus,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserModel } from '../users/schema/user.model';
import { AuthErrorService } from '../utils/errors-handler';
import { JwtService } from '@nestjs/jwt';
import { Role } from 'src/auth/enums/role.enum';
import { EmailService } from 'src/notifications/email/email.service';
import { PasswordSecurityService } from 'src/authentication/security/password-security.service';
import { INITIAL_ADMIN_EMAIL } from 'src/admin/constants/admin.constants';
import {
	RAG_ERASURE,
	RagErasurePort,
} from 'src/users/application/rag-erasure.port';

@Injectable()
export class UsersService {
	private readonly logger = new Logger(UsersService.name);

	constructor(
		private readonly jwtService: JwtService,
		private readonly emailService: EmailService,
		private readonly passwordSecurityService: PasswordSecurityService,
		@Inject(RAG_ERASURE)
		private readonly ragErasure: RagErasurePort
	) {}
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

			const hashedPassword =
				await this.passwordSecurityService.hashPassword(password);

			const newUser = new UserModel({
				firstName,
				lastName,
				email,
				password: hashedPassword,
				role: email === INITIAL_ADMIN_EMAIL ? Role.Admin : Role.User,
			});

			await newUser.save();

			try {
				await this.emailService.sendWelcomeEmail(
					newUser.email,
					newUser.firstName
				);
			} catch (emailError) {
				this.logger.warn(
					`Falha ao enviar email de boas-vindas para ${newUser.email}: ${
						(emailError as any)?.message || 'erro desconhecido'
					}`
				);
			}

			// Gera o token JWT com o formato aceito pelo JwtStrategy
			const payload = {
				userId: newUser.id,
				type: 'access',
				role: newUser.role ?? Role.User,
			};
			const accessToken = this.jwtService.sign(payload);

			return {
				message: 'User created successfully',
				user: {
					_id: newUser._id,
					firstName: newUser.firstName,
					lastName: newUser.lastName,
					email: newUser.email,
					role: newUser.role,
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
		const deleted = await UserModel.findByIdAndDelete(id);
		if (!deleted) return deleted;

		// LGPD (TRA-78): o RAG mantem uma copia do dado financeiro do usuario
		// num Postgres separado. Apagar so o registro transacional deixaria
		// essa copia viva indefinidamente.
		//
		// Roda DEPOIS da exclusao no Mongo, e nao antes, porque a ordem
		// inversa apagaria os embeddings de um usuario que talvez continuasse
		// existindo se o delete do Mongo falhasse.
		//
		// Nao lanca: o adapter ja registra ERROR e faz retry. Recusar a
		// exclusao da conta porque um servico secundario esta fora negaria ao
		// usuario o proprio direito que esta rotina existe pra atender.
		await this.ragErasure.eraseUserData(id);

		return deleted;
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
