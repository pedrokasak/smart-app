import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { IsEmail, IsNotEmpty, IsStrongPassword } from 'class-validator';
import { Match } from 'src/utils/decorators';

export class UpdateUserDto extends PartialType(CreateUserDto) {
	@IsNotEmpty({
		message: 'The fist name is not empty',
	})
	firstName: string;

	@IsNotEmpty({
		message: 'The last name is not empty',
	})
	lastName: string;

	@IsNotEmpty({
		message: 'The email is not empty',
	})
	@IsEmail({})
	email: string;

	@IsNotEmpty({
		message: 'The password is not empty',
	})
	@IsStrongPassword({
		minLength: 8,
		minUppercase: 1,
		minLowercase: 1,
	})
	password: string;

	@Match('password', { message: 'Passwords do not match' })
	confirmPassword: string;
}
