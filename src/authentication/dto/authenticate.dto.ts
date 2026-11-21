import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
	IsBoolean,
	IsEmail,
	IsEmpty,
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
	ValidateNested,
} from 'class-validator';
import { SessionDeviceDto } from './session-device.dto';

export class AuthenticateDto {
	@IsEmail()
	@MaxLength(254)
	@ApiProperty()
	@IsNotEmpty({ message: 'The email is not empty' })
	email: string;

	@MinLength(6)
	@MaxLength(128)
	@IsString()
	@ApiProperty()
	@IsNotEmpty({ message: 'The password is not empty' })
	password: string;

	@IsBoolean({ message: 'The keepConnected is a boolean type' })
	@IsNotEmpty()
	@ApiProperty()
	keepConnected: boolean;

	@IsOptional()
	@IsObject()
	@ValidateNested()
	@Type(() => SessionDeviceDto)
	@ApiProperty({ type: SessionDeviceDto, required: false })
	device?: SessionDeviceDto;

	@IsEmpty()
	token: string;
}

export class AuthSignoutDto {
	// TRA-217: o cliente novo manda o refresh token via cookie httpOnly, não
	// mais no body. Opcional aqui só pra aceitar o cliente antigo em cache
	// durante a transição; o controller usa o cookie quando ele existir.
	@ApiProperty({
		description:
			'JWT token to invalidate (legacy; o cliente novo usa o cookie)',
		example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
		required: false,
	})
	@IsOptional()
	@IsString()
	token?: string;
}

export class RefreshTokenDto {
	// TRA-217: idem — opcional pro cliente antigo, o controller prefere o
	// cookie quando presente.
	@ApiProperty({
		description:
			'Refresh token to get new access token (legacy; o cliente novo usa o cookie)',
		example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
		required: false,
	})
	@IsOptional()
	@IsString()
	refreshToken?: string;
}
