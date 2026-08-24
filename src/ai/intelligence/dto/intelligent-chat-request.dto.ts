import { Type } from 'class-transformer';
import {
	IsIn,
	IsNumber,
	IsOptional,
	IsString,
	MaxLength,
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

/**
 * Pergunta de usuário tem tamanho de pergunta. Sem teto, o corpo de 1MB
 * aceito pelo servidor virava prompt, e cada requisição custava uma chamada
 * paga de LLM proporcional ao tamanho — um único usuário autenticado gerava
 * custo sem limite (TRA-89).
 */
const MAX_QUESTION_LENGTH = 2000;

export class IntelligentChatRequestDto {
	@IsString()
	@MaxLength(MAX_QUESTION_LENGTH)
	question: string;

	@IsOptional()
	@IsIn(['renda', 'crescimento', 'conservador', 'agressivo'])
	investorProfile?: 'renda' | 'crescimento' | 'conservador' | 'agressivo';

	@IsOptional()
	@IsIn([
		'sell_asset',
		'rebalance_portfolio',
		'reduce_risk_20',
		'committee_mode',
	])
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
