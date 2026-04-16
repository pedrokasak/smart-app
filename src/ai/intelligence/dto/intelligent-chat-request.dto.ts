export class IntelligentChatRequestDto {
	question: string;
	investorProfile?: 'renda' | 'crescimento' | 'conservador' | 'agressivo';
	copilotFlow?:
		| 'sell_asset'
		| 'rebalance_portfolio'
		| 'reduce_risk_20'
		| 'committee_mode';
	decisionFlow?: {
		action: 'sell' | 'rebalance' | 'reduce_risk';
		ticker?: string;
		targetRiskReductionPct?: number;
		quantity?: number;
		sellPrice?: number;
	};
}
