import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, Max, Min } from 'class-validator';
import {
	INVESTMENT_BENCHMARKS,
	InvestmentBenchmark,
	InvestmentPolicy,
} from 'src/investment-policy/domain/investment-policy';

const PERCENT_OPTIONS = {
	allowNaN: false,
	allowInfinity: false,
	maxDecimalPlaces: 2,
};

export class UpdateInvestmentPolicyDto implements InvestmentPolicy {
	@ApiProperty({ example: 8 })
	@IsNumber(PERCENT_OPTIONS)
	@Min(0)
	@Max(100)
	maxAssetWeightPct!: number;

	@ApiProperty({ example: 25 })
	@IsNumber(PERCENT_OPTIONS)
	@Min(0)
	@Max(100)
	maxSectorWeightPct!: number;

	@ApiProperty({ example: 25 })
	@IsNumber(PERCENT_OPTIONS)
	@Min(0)
	@Max(100)
	fixedIncomeTargetPct!: number;

	@ApiProperty({ example: 28 })
	@IsNumber(PERCENT_OPTIONS)
	@Min(0)
	@Max(100)
	brStocksTargetPct!: number;

	@ApiProperty({ example: 5 })
	@IsNumber(PERCENT_OPTIONS)
	@Min(0)
	@Max(100)
	maxCryptoPct!: number;

	@ApiProperty({ enum: INVESTMENT_BENCHMARKS, example: 'IBOV_CDI' })
	@IsIn(INVESTMENT_BENCHMARKS)
	benchmark!: InvestmentBenchmark;
}
