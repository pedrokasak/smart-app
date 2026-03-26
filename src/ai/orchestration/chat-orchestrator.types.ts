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
	| 'narrative_synthesis'
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
			| 'ambiguous_question';
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
		portfolioRisk?: unknown;
		dividendProjection?: unknown;
		comparison?: unknown;
		sellSimulation?: unknown;
		portfolioFit?: unknown;
		externalAsset?: MarketAssetSnapshot | null;
		opportunities?: unknown;
		futureSimulation?: unknown;
		riSummary?: unknown;
		riComparison?: unknown;
	};
	unavailable: string[];
	warnings: string[];
	assumptions: string[];
}

export interface ChatOwnedAssetContext {
	position: PortfolioIntelligencePosition;
	isOwned: boolean;
}
