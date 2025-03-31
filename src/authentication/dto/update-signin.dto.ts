import { PartialType } from '@nestjs/mapped-types';
import { AuthenticateDto } from './authenticate.dto';
import { IsBoolean, IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class UpdateSigninDto extends PartialType(AuthenticateDto) {
	@IsEmail()
	@IsNotEmpty({ message: 'The email is not empty' })
	email: string;

	@MinLength(6)
	@IsNotEmpty({ message: 'The password is not empty' })
	password: string;

	@IsBoolean({ message: 'The keepConnected is a boolean type' })
	keepConnected: boolean;

	token: string;
}
