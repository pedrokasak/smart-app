import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
	IsEmail,
	IsEnum,
	IsInt,
	IsMongoId,
	IsNumber,
	IsOptional,
	IsString,
	Max,
	Min,
	ValidateIf,
} from 'class-validator';
import { ManualGrantType } from '../constants/admin.constants';
import {
	MAX_DISCOUNT_PERCENT,
	MAX_TRIAL_DURATION_DAYS,
	MIN_DISCOUNT_PERCENT,
	MIN_TRIAL_DURATION_DAYS,
} from '../constants/admin.constants';

export class ManualGrantDto {
	@ApiProperty()
	@IsEmail()
	email: string;

	@ApiProperty()
	@IsMongoId()
	planId: string;

	@ApiProperty({ enum: Object.values(ManualGrantType) })
	@IsEnum(ManualGrantType)
	grantType: ManualGrantType;

	@ApiPropertyOptional({
		description:
			'Duração do trial em dias. Obrigatório quando grantType = TRIAL.',
		minimum: MIN_TRIAL_DURATION_DAYS,
		maximum: MAX_TRIAL_DURATION_DAYS,
	})
	@ValidateIf((dto: ManualGrantDto) => dto.grantType === ManualGrantType.Trial)
	@IsInt()
	@Min(MIN_TRIAL_DURATION_DAYS)
	@Max(MAX_TRIAL_DURATION_DAYS)
	trialDurationDays?: number;

	@ApiPropertyOptional({
		description: 'Desconto percentual opcional aplicado à concessão.',
		minimum: MIN_DISCOUNT_PERCENT,
		maximum: MAX_DISCOUNT_PERCENT,
	})
	@IsOptional()
	@IsNumber()
	@Min(MIN_DISCOUNT_PERCENT)
	@Max(MAX_DISCOUNT_PERCENT)
	discountPercent?: number;

	@ApiPropertyOptional()
	@IsOptional()
	@IsString()
	notes?: string;
}
