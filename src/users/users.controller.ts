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
import { Public } from 'src/utils/constants';

@Controller('users')
export class UsersController {
	constructor(private readonly usersService: UsersService) {}

	@Public()
	@Post('create')
	@UsePipes(new EmailValidationPipe())
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
	@UseGuards(JwtAuthGuard)
	findAll() {
		return this.usersService.findMany();
	}

	@Get(':id')
	@UseGuards(JwtAuthGuard)
	findOne(@Param('id') id: string) {
		return this.usersService.findOne(id);
	}

	@Patch('update/:id')
	@UseGuards(JwtAuthGuard)
	update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
		return this.usersService.update(id, updateUserDto);
	}

	@Delete(':id')
	@UseGuards(JwtAuthGuard)
	remove(@Param('id') id: string) {
		return this.usersService.delete(id);
	}
}
