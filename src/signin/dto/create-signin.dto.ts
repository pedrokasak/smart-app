import { ApiProperty } from '@nestjs/swagger';
import {
	IsBoolean,
	IsEmail,
	IsEmpty,
	IsNotEmpty,
	MinLength,
} from 'class-validator';

export class CreateSigninDto {
	@IsEmail()
	@ApiProperty()
	@IsNotEmpty({
		message: 'The email is not empty',
	})
	email: string;

	@MinLength(6)
	@ApiProperty()
	@IsNotEmpty({
		message: 'The password is not empty',
	})
	password: string;

	@IsBoolean({
		message: 'The keepConnected is a boolean type',
	})
	@IsNotEmpty()
	@ApiProperty()
	keepConnected: boolean;

	@IsEmpty()
	token: string;
}
