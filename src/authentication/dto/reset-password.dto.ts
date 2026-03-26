import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
	IsNotEmpty,
	IsOptional,
	IsString,
	Matches,
	MinLength,
} from 'class-validator';

export class ResetPasswordDto {
	@IsString()
	@ApiProperty()
	@IsNotEmpty({ message: 'Token is required' })
	token: string;

	@MinLength(8, {
		message: 'A senha deve conter no mínimo 8 caracteres',
	})
	@Matches(/[A-Z]/, {
		message: 'A senha deve conter pelo menos 1 letra maiúscula',
	})
	@Matches(/[a-z]/, {
		message: 'A senha deve conter pelo menos 1 letra minúscula',
	})
	@Matches(/\d/, {
		message: 'A senha deve conter pelo menos 1 número',
	})
	@Matches(/[^A-Za-z0-9]/, {
		message: 'A senha deve conter pelo menos 1 caractere especial',
	})
	@ApiProperty()
	@IsNotEmpty({ message: 'The new password is not empty' })
	newPassword: string;

	@IsString()
	@ApiProperty()
	@IsNotEmpty({ message: 'A confirmação da senha é obrigatória' })
	confirmPassword: string;

	@ApiPropertyOptional()
	@IsOptional()
	@IsString()
	tfCode?: string;
}
