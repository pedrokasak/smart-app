import { Type } from 'class-transformer';
import {
	IsIn,
	IsNumber,
	IsOptional,
	IsString,
	ValidateNested,
} from 'class-validator';

class DecisionFlowDto {
	@IsIn(['sell', 'rebalance', 'reduce_risk'])
	action: 'sell' | 'rebalance' | 'reduce_risk';

	@IsOptional()
	@IsString()
	ticker?: string;

	@IsOptional()
	@IsNumber()
	targetRiskReductionPct?: number;

	@IsOptional()
	@IsNumber()
	quantity?: number;

	@IsOptional()
	@IsNumber()
	sellPrice?: number;
}

export class IntelligentChatRequestDto {
	@IsString()
	question: string;

	@IsOptional()
	@IsIn(['renda', 'crescimento', 'conservador', 'agressivo'])
	investorProfile?: 'renda' | 'crescimento' | 'conservador' | 'agressivo';

	@IsOptional()
	@IsIn(['sell_asset', 'rebalance_portfolio', 'reduce_risk_20', 'committee_mode'])
	copilotFlow?:
		| 'sell_asset'
		| 'rebalance_portfolio'
		| 'reduce_risk_20'
		| 'committee_mode';

	@IsOptional()
	@ValidateNested()
	@Type(() => DecisionFlowDto)
	decisionFlow?: DecisionFlowDto;
}
