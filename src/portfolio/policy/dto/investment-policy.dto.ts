import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsNumber,
	IsString,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
	ValidateNested,
} from 'class-validator';
import { MAX_POLICY_TARGETS } from '../domain/investment-policy';

export class PolicyTargetDto {
	@IsString()
	@Matches(/^[a-z][a-z0-9_]{0,39}$/, {
		message: 'key deve ser minúscula, com letras, números ou _.',
	})
	key: string;

	@IsString()
	@MinLength(1)
	@MaxLength(60)
	label: string;

	@IsNumber({ allowNaN: false, allowInfinity: false })
	@Min(0)
	@Max(100)
	pct: number;
}

export class InvestmentPolicyDto {
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(MAX_POLICY_TARGETS)
	@ValidateNested({ each: true })
	@Type(() => PolicyTargetDto)
	targets: PolicyTargetDto[];

	@IsNumber({ allowNaN: false, allowInfinity: false })
	@Min(1)
	@Max(100)
	maxPositionPct: number;
}
