import { IsEmail, IsNotEmpty, IsStrongPassword } from 'class-validator';

export class CreateUserDto {
	@IsNotEmpty({
		message: 'The fist name is not empty',
	})
	first_name: string;

	@IsNotEmpty({
		message: 'The last name is not empty',
	})
	last_name: string;

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
}
