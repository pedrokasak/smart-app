import { Type } from 'class-transformer';
import {
	IsBoolean,
	IsString,
	IsEnum,
	IsIn,
	IsOptional,
	MinLength,
	MaxLength,
	Matches,
	ValidateIf,
	ValidateNested,
} from 'class-validator';
import {
	PORTFOLIO_PURPOSES,
	PortfolioPurpose,
} from 'src/portfolio/policy/domain/portfolio-policy';
import { PortfolioPolicyDto } from 'src/portfolio/policy/dto/portfolio-policy.dto';

export class CreatePortfolioDto {
	@IsString()
	@MinLength(3)
	@MaxLength(100)
	name: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	description?: string;

	@IsOptional()
	@ValidateIf((_o, v) => v != null && v !== '')
	@IsString()
	@Matches(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/, {
		message: 'CPF deve estar no formato: 123.456.789-00',
	})
	cpf?: string;

	@IsEnum(['self', 'spouse', 'child', 'other'])
	ownerType: 'self' | 'spouse' | 'child' | 'other';

	@IsOptional()
	@IsString()
	ownerName?: string;

	/** Finalidade escolhida no assistente "Nova carteira" (TRA-106). */
	@IsOptional()
	@IsIn(PORTFOLIO_PURPOSES)
	purpose?: PortfolioPurpose;

	/**
	 * Política explícita. Sem ela, vale a sugerida pela finalidade (ou a da
	 * carteira principal, com `inheritPrimaryPolicy`).
	 */
	@IsOptional()
	@ValidateNested()
	@Type(() => PortfolioPolicyDto)
	policy?: PortfolioPolicyDto;

	/** "Usar a mesma política da carteira principal" do handoff. */
	@IsOptional()
	@IsBoolean()
	inheritPrimaryPolicy?: boolean;
}
