import { ApiProperty } from '@nestjs/swagger';
import {
	IsBoolean,
	IsEmail,
	IsEmpty,
	IsNotEmpty,
	IsString,
	MinLength,
} from 'class-validator';

export class AuthenticateDto {
	@IsEmail()
	@ApiProperty()
	@IsNotEmpty({ message: 'The email is not empty' })
	email: string;

	@MinLength(6)
	@ApiProperty()
	@IsNotEmpty({ message: 'The password is not empty' })
	password: string;

	@IsBoolean({ message: 'The keepConnected is a boolean type' })
	@IsNotEmpty()
	@ApiProperty()
	keepConnected: boolean;

	@IsEmpty()
	token: string;
}

export class AuthSignoutDto {
	@ApiProperty({
		description: 'JWT token to invalidate',
		example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
	})
	@IsNotEmpty({ message: 'The token is not empty' })
	@IsString()
	token: string;
}

export class RefreshTokenDto {
	@ApiProperty({
		description: 'Refresh token to get new access token',
		example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
	})
	@IsNotEmpty({ message: 'The refresh token is not empty' })
	@IsString()
	refreshToken: string;
}
