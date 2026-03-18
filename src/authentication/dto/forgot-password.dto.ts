import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class ForgotPasswordDto {
	@IsEmail()
	@ApiProperty()
	@IsNotEmpty({ message: 'The email is not empty' })
	email: string;
}
