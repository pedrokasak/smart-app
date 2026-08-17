import { IsIn, IsNumber, IsOptional, Min } from 'class-validator';

export class FutureSimulatorRequestDto {
	@IsIn(['6m', '1y', '5y', '10y'])
	horizon: '6m' | '1y' | '5y' | '10y';

	@IsOptional()
	@IsNumber()
	@Min(0)
	monthlyContribution?: number;
}
