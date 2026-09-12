import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
	UseGuards,
	UsePipes,
	HttpException,
	HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { EmailValidationPipe } from './decorators/emailValidatorPipe';
import { JwtAuthGuard } from '../authentication/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { Public } from 'src/utils/constants';
import {
	ApiBearerAuth,
	ApiOkResponse,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';

@Controller('users')
@ApiTags('users')
@ApiBearerAuth('access-token')
export class UsersController {
	constructor(private readonly usersService: UsersService) {}

	@Public()
	@Post('create')
	@UsePipes(new EmailValidationPipe())
	@ApiOperation({ summary: 'Cria um novo usuário' })
	@ApiResponse({
		status: 201,
		description: 'Usuário criado com sucesso',
		type: CreateUserDto,
	})
	@ApiResponse({
		status: 400,
		description: 'Dados inválidos',
	})
	@ApiResponse({
		status: 500,
		description: 'Erro interno inesperado',
	})
	@ApiOkResponse({
		description: 'Create a new user',
		type: CreateUserDto,
		schema: {
			type: 'object',
			properties: {
				firstName: { type: 'string' },
				lastName: { type: 'string' },
				email: { type: 'string' },
				password: { type: 'string' },
				confirmPassword: { type: 'string' },
			},
		},
	})
	async create(@Body() createUserDto: CreateUserDto) {
		try {
			const response = await this.usersService.create(createUserDto);
			return response;
		} catch (error) {
			if (error instanceof HttpException) {
				throw new HttpException(error.getResponse(), error.getStatus());
			} else {
				throw new HttpException(
					'Unexpected error',
					HttpStatus.INTERNAL_SERVER_ERROR
				);
			}
		}
	}

	@Get()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.Admin)
	@ApiOperation({ summary: 'Retorna uma lista de usuários (admin)' })
	@ApiResponse({
		status: 200,
		description: 'Retorna uma lista de usuários',
	})
	findAll() {
		return this.usersService.findMany();
	}

	@Get(':id')
	@UseGuards(JwtAuthGuard)
	@ApiOperation({ summary: 'Retorna um usuário pelo ID' })
	@ApiResponse({
		status: 200,
		description: 'Retorna um usuário pelo ID',
	})
	findOne(@Param('id') id: string) {
		return this.usersService.findOne(id);
	}

	@Patch('update/:id')
	@UseGuards(JwtAuthGuard)
	@ApiOperation({ summary: 'Atualiza um usuário pelo ID' })
	@ApiResponse({
		status: 200,
		description: 'Usuário atualizado com sucesso',
	})
	update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
		return this.usersService.update(id, updateUserDto);
	}

	@Delete(':id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.Admin)
	@ApiOperation({ summary: 'Remove um usuário pelo ID (admin)' })
	@ApiResponse({
		status: 200,
		description: 'Usuário removido com sucesso',
	})
	remove(@Param('id') id: string) {
		return this.usersService.delete(id);
	}

	@Patch(':id/role')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(Role.Admin)
	@ApiOperation({ summary: 'Altera o role de um usuário (admin)' })
	@ApiResponse({ status: 200, description: 'Role atualizado com sucesso' })
	async updateRole(@Param('id') id: string, @Body() body: { role: Role }) {
		return this.usersService.updateUserRole(id, body.role);
	}
}
