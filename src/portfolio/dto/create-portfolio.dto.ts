import {
	IsString,
	IsEnum,
	IsOptional,
	MinLength,
	MaxLength,
	Matches,
} from 'class-validator';

export class CreatePortfolioDto {
	@IsString()
	@MinLength(3)
	@MaxLength(100)
	name: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	description?: string;

	@IsString()
	@Matches(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/, {
		message: 'CPF deve estar no formato: 123.456.789-00',
	})
	cpf: string;

	@IsEnum(['self', 'spouse', 'child', 'other'])
	ownerType: 'self' | 'spouse' | 'child' | 'other';

	@IsOptional()
	@IsString()
	ownerName?: string;

	@IsEnum(['free', 'premium', 'pro'])
	plan: 'free' | 'premium' | 'pro';
}
