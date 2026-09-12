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

/**
 * Consumo de um código de recuperação no lugar do TOTP.
 *
 * O `Length` é folgado de propósito: o código canônico tem 8 caracteres, mas
 * quem digita de uma captura de tela manda hífen, espaço e minúscula. A
 * normalização é responsabilidade de `normalizeRecoveryCode`, não do DTO —
 * um `Length(9, 9)` aqui recusaria um código correto digitado sem o hífen.
 */
export class TwoFactorRecoveryConsumeDto {
	@ApiProperty({ description: 'Token temporário retornado no signin' })
	@IsString()
	tempToken: string;

	@ApiProperty({
		description:
			'Código de recuperação, com ou sem separadores (ex.: A1B2-C3D4)',
	})
	@IsString()
	@Length(8, 32)
	recoveryCode: string;
}
