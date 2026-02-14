import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateProfileDto } from './create-profile.dto';
import { IsString, IsOptional, Matches } from 'class-validator';

export class UpdateProfileDto extends PartialType(CreateProfileDto) {
	@ApiProperty({ required: false })
	@IsOptional()
	@IsString()
	@Matches(/^\(\d{2}\) \d{4,5}-\d{4}$/, {
		message: 'Telefone deve estar no formato: (11) 99999-9999',
	})
	phone?: string;

	@ApiProperty({ required: false })
	@IsOptional()
	birthDate?: Date;

	@ApiProperty({ required: false })
	@IsOptional()
	address?: {
		street?: string;
		number?: string;
		complement?: string;
		city?: string;
		state?: string;
		zipCode?: string;
		country?: string;
	};

	@ApiProperty({ required: false })
	@IsOptional()
	preferences?: {
		language?: 'pt-BR' | 'en-US' | 'es-ES';
		theme?: 'light' | 'dark';
		notifications?: boolean;
		twoFactorEnabled?: boolean;
	};
}
