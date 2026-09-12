import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TwoFactorVerifyDto {
	@ApiProperty({ description: 'Código TOTP de 6 dígitos do autenticador' })
	@IsString()
	@Length(6, 6)
	code: string;
}

export class TwoFactorAuthenticateDto {
	@ApiProperty({ description: 'Token temporário retornado no signin' })
	@IsString()
	tempToken: string;

	@ApiProperty({ description: 'Código TOTP de 6 dígitos' })
	@IsString()
	@Length(6, 6)
	code: string;
}
