import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
	IsIn,
	IsInt,
	IsNumber,
	IsString,
	Length,
	Max,
	Min,
} from 'class-validator';
import {
	GOAL_KINDS,
	GoalKind,
} from 'src/financial-plan/infrastructure/financial-plan.model';

const MONEY = { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 };

export class UpdateFinancialPlanDto {
	@ApiProperty({ example: 8500 })
	@IsNumber(MONEY)
	@Min(0)
	@Max(1e9)
	monthlyContribution!: number;

	@ApiProperty({ example: 6.4 })
	@IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
	@Min(-20)
	@Max(30)
	expectedRealReturnPct!: number;

	@ApiProperty({ example: 20 })
	@IsInt()
	@Min(1)
	@Max(50)
	horizonYears!: number;
}

export class CreateGoalDto {
	@ApiProperty({ example: 'Entrada do imóvel' })
	@IsString()
	@Length(1, 60)
	title!: string;

	@ApiProperty({ enum: GOAL_KINDS })
	@IsIn(GOAL_KINDS)
	kind!: GoalKind;

	@ApiProperty({ example: 420000 })
	@IsNumber(MONEY)
	@Min(1)
	@Max(1e11)
	targetAmount!: number;

	@ApiProperty({ example: 148500 })
	@IsNumber(MONEY)
	@Min(0)
	@Max(1e11)
	currentAmount!: number;

	@ApiProperty({ example: 3500 })
	@IsNumber(MONEY)
	@Min(0)
	@Max(1e9)
	monthlyContribution!: number;
}

export class UpdateGoalDto extends PartialType(CreateGoalDto) {}
