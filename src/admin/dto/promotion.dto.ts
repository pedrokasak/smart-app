import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
	IsDate,
	IsIn,
	IsInt,
	IsNumber,
	IsOptional,
	Matches,
	Max,
	Min,
	ValidateIf,
} from 'class-validator';

/** Cupom criado pelo admin (TRA-182): percentual OU valor fixo em reais. */
export class CreatePromotionDto {
	@ApiProperty({
		example: 'BLACKFRIDAY30',
		description: 'Código que a pessoa digita no checkout',
	})
	@Matches(/^[A-Z0-9_-]{3,32}$/, {
		message: 'Código com 3 a 32 letras maiúsculas, números, _ ou -',
	})
	code!: string;

	@ApiPropertyOptional({ example: 30, description: 'Desconto em % (1 a 100)' })
	@ValidateIf((dto) => dto.amountOff === undefined)
	@IsNumber()
	@Min(1)
	@Max(100)
	percentOff?: number;

	@ApiPropertyOptional({ example: 10, description: 'Desconto fixo em reais' })
	@ValidateIf((dto) => dto.percentOff === undefined)
	@IsNumber()
	@Min(0.01)
	amountOff?: number;

	@ApiProperty({ enum: ['once', 'repeating', 'forever'] })
	@IsIn(['once', 'repeating', 'forever'])
	duration!: 'once' | 'repeating' | 'forever';

	@ApiPropertyOptional({
		example: 3,
		description: 'Meses de desconto quando repeating',
	})
	@ValidateIf((dto) => dto.duration === 'repeating')
	@IsInt()
	@Min(1)
	@Max(36)
	durationInMonths?: number;

	@ApiPropertyOptional({ example: 100, description: 'Limite de usos' })
	@IsOptional()
	@IsInt()
	@Min(1)
	maxRedemptions?: number;

	@ApiPropertyOptional({ description: 'Validade (ISO)' })
	@IsOptional()
	@Type(() => Date)
	@IsDate()
	redeemBy?: Date;
}
