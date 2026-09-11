import { MarketAssetSnapshot } from 'src/market-data/application/market-data-provider.port';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

export type ChatOrchestratorIntent =
	| 'portfolio_summary'
	| 'portfolio_risk'
	| 'sell_simulation'
	| 'dividend_projection'
	| 'future_scenario'
	| 'benchmark_simple'
	| 'asset_comparison'
	| 'external_asset_analysis'
	| 'portfolio_fit_analysis'
	| 'tax_estimation'
	| 'opportunity_radar'
	| 'ri_summary'
	| 'ri_comparison'
	| 'investment_committee'
	| 'narrative_synthesis'
	| 'external_asset_question'
	| 'market_screening'
	// Análises do prompt avançado do Copiloto no handoff (TRA-141).
	| 'correlation_matrix'
	| 'return_attribution'
	// Pedido quantitativo que o produto ainda não calcula. Responder com recusa
	// honesta em vez de deixar o LLM inventar VaR por fator ou carry fiscal.
	| 'unsupported_quant_analysis'
	| 'unknown';

export type ChatRouteType = 'deterministic_no_llm' | 'synthesis_required';

export interface ChatOrchestratorResponse {
	intent: ChatOrchestratorIntent;
	deterministic: true;
	route: {
		type: ChatRouteType;
		llmEligible: boolean;
		reason:
			| 'rules_resolved'
			| 'insufficient_structured_data'
			| 'narrative_requested'
			| 'ambiguous_question'
			| 'capability_not_available';
	};
	cache: {
		key: string | null;
		hit: boolean;
		ttlSeconds: number | null;
	};
	cost: {
		llmCalls: number;
		tokenUsageEstimate: number;
		estimatedLlmCallsAvoidedByCache: number;
	};
	question: string;
	context: {
		mentionedSymbols: string[];
		ownedSymbols: string[];
		externalSymbols: string[];
		positionsCount: number;
	};
	data: {
		portfolioSummary?: unknown;
		portfolioAssets?: unknown;
		portfolioRisk?: unknown;
		rebalanceSuggestion?: unknown;
		dividendProjection?: unknown;
		comparison?: unknown;
		sellSimulation?: unknown;
		portfolioFit?: unknown;
		externalAsset?: MarketAssetSnapshot | null;
		opportunities?: unknown;
		futureSimulation?: unknown;
		riSummary?: unknown;
		riComparison?: unknown;
		trackerrScore?: unknown;
		tradePlaybook?: unknown;
		riTimeline?: unknown;
		rebalancePlan?: unknown;
		personalizedInsights?: unknown;
		investmentCommittee?: unknown;
		correlationMatrix?: unknown;
		returnAttribution?: unknown;
	};
	unavailable: string[];
	warnings: string[];
	assumptions: string[];
}

export interface ChatOwnedAssetContext {
	position: PortfolioIntelligencePosition;
	isOwned: boolean;
}
