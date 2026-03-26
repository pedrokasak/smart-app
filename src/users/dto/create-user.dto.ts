import {
	IsEmail,
	IsNotEmpty,
	IsOptional,
	IsString,
	Matches,
	MinLength,
} from 'class-validator';
import { Match } from '../../utils/decorators';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
	@ApiProperty({
		example: 'Pedro Herique',
		description: 'Primeiro nome do usuário',
	})
	@IsNotEmpty({
		message: 'The fist name is not empty',
	})
	firstName: string;

	@ApiProperty({
		example: 'De Souza',
		description: 'Sobrenome do usuário',
	})
	@IsNotEmpty({
		message: 'The last name is not empty',
	})
	lastName: string;

	@ApiProperty({
		example:
			'https://images.unsplash.com/photo-1499714608240-22fc6ad53fb2?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=100&q=80',
		description: 'URL da imagem do usuário',
	})
	@IsOptional()
	@IsString()
	avatar: string;

	@IsNotEmpty({
		message: 'The email is not empty',
	})
	@ApiProperty({
		example: 'pedro@example.com',
		description: 'E-mail do usuário',
	})
	@IsEmail({})
	email: string;

	@IsNotEmpty({
		message: 'The password is not empty',
	})
	@MinLength(8, {
		message: 'A senha deve conter no mínimo 8 caracteres',
	})
	@Matches(/[A-Z]/, {
		message: 'A senha deve conter pelo menos 1 letra maiúscula',
	})
	@Matches(/[a-z]/, {
		message: 'A senha deve conter pelo menos 1 letra minúscula',
	})
	@Matches(/\d/, {
		message: 'A senha deve conter pelo menos 1 número',
	})
	@Matches(/[^A-Za-z0-9]/, {
		message: 'A senha deve conter pelo menos 1 caractere especial',
	})
	@ApiProperty({
		example: 'StrongPass123@',
		description:
			'Senha do usuário (mínimo 8 caracteres, com maiúscula, minúscula, número e caractere especial)',
	})
	password: string;

	@ApiProperty({
		example: 'StrongPass123',
		description: 'Confirmação da senha do usuário',
	})
	@IsNotEmpty({
		message: 'The confirm password is not empty',
	})
	@Match('password', { message: 'Passwords do not match' })
	confirmPassword: string;
}
