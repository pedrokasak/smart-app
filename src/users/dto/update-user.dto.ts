import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';
import { IsNotEmpty } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
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
	email: string;

	@IsNotEmpty({
		message: 'The password is not empty',
	})
	password: string;
}
