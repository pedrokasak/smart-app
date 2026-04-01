import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import {
	CHAT_COST_OBSERVER,
	ChatCostObserverPort,
} from 'src/ai/orchestration/chat-cost-observer.port';
import {
	ChatOrchestratorIntent,
	ChatRouteType,
	ChatOrchestratorResponse,
} from 'src/ai/orchestration/chat-orchestrator.types';
import {
	CHAT_RESPONSE_CACHE,
	ChatResponseCachePort,
} from 'src/ai/orchestration/chat-response-cache.port';
import { UnifiedIntelligenceFacade } from 'src/intelligence/application/unified-intelligence.facade';
import { FutureSimulatorHorizon } from 'src/intelligence/application/unified-intelligence.types';
import {
	MARKET_DATA_PROVIDER,
	MarketDataProviderPort,
} from 'src/market-data/application/market-data-provider.port';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import {
	RI_DOCUMENT_QUERY,
	RiDocumentQueryPort,
} from 'src/ri-intelligence/application/ri-document-query.port';
import { RiDocumentSummaryOutput } from 'src/ri-intelligence/application/ri-summary.types';

@Injectable()
export class ChatOrchestratorService {
	constructor(
		private readonly portfolioService: PortfolioService,
		private readonly unifiedIntelligenceFacade: UnifiedIntelligenceFacade,
		@Inject(MARKET_DATA_PROVIDER)
		private readonly marketDataProvider: MarketDataProviderPort,
		@Inject(CHAT_RESPONSE_CACHE)
		private readonly responseCache: ChatResponseCachePort<ChatOrchestratorResponse>,
		@Inject(CHAT_COST_OBSERVER)
		private readonly costObserver: ChatCostObserverPort,
		private readonly riDocumentSummaryService: RiDocumentSummaryService,
		@Optional()
		@Inject(RI_DOCUMENT_QUERY)
		private readonly riDocumentQuery?: RiDocumentQueryPort
	) {}

	async orchestrate(
		userId: string,
		question: string,
		options?: {
			marketDataVersion?: string | null;
		}
	): Promise<ChatOrchestratorResponse> {
		const normalizedQuestion = String(question || '').trim();
		const symbols = this.extractSymbols(normalizedQuestion);
		const intent = this.classifyIntent(normalizedQuestion, symbols);
		const predictedRouteType =
			intent === 'narrative_synthesis' || intent === 'unknown'
				? 'synthesis_required'
				: 'deterministic_no_llm';

		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const assets = portfolios.flatMap((portfolio: any) =>
			Array.isArray(portfolio?.assets) ? portfolio.assets : []
		);
		const positions = this.toPositions(assets);
		const bySymbol = new Map(
			positions.map((position) => [
				this.normalizeTicker(position.symbol),
				position,
			])
		);

		const ownedSymbols = symbols.filter((symbol) =>
			bySymbol.has(this.normalizeTicker(symbol))
		);
		const externalSymbols = symbols.filter(
			(symbol) => !bySymbol.has(this.normalizeTicker(symbol))
		);
		const userPlan = this.resolveUserPlan(portfolios);
		const portfolioHash = this.computePortfolioHash(positions);
		const marketDataVersion = this.resolveMarketDataVersion({
			intent,
			provided: options?.marketDataVersion || null,
		});
		const cacheKey = this.buildCacheKey({
			question: normalizedQuestion,
			portfolioHash,
			userPlan,
			marketDataVersion,
			responseMode: predictedRouteType,
		});
		const ttlSeconds = this.resolveCacheTtl(intent, predictedRouteType);
		const canCache = this.canCacheIntent(intent, marketDataVersion);
		const unavailable: string[] = [];
		const warnings: string[] = [];
		const assumptions: string[] = [];
		let cacheHit = false;

		if (canCache) {
			try {
				const cached = await this.responseCache.get(cacheKey);
				if (cached) {
					cacheHit = true;
					const hydrated: ChatOrchestratorResponse = {
						...cached,
						cache: {
							key: cacheKey,
							hit: true,
							ttlSeconds,
						},
						cost: {
							llmCalls: 0,
							tokenUsageEstimate: 0,
							estimatedLlmCallsAvoidedByCache:
								cached.route.type === 'synthesis_required' ? 1 : 0,
						},
					};
					this.safeRecordCost({
						routeType: hydrated.route.type,
						cacheHit: true,
						llmEligible: hydrated.route.llmEligible,
						estimatedLlmCallsAvoided:
							hydrated.route.type === 'synthesis_required' ? 1 : 0,
					});
					return hydrated;
				}
			} catch (_error) {
				warnings.push('chat_cache_unavailable');
			}
		}

		if (intent === 'portfolio_summary') {
			const portfolioSummary =
				this.unifiedIntelligenceFacade.getPortfolioSummary({
					positions,
				});
			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: { portfolioSummary },
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'portfolio_risk') {
			const portfolioRisk =
				this.unifiedIntelligenceFacade.getPortfolioRiskAnalysis({
					positions,
				});
			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: { portfolioRisk },
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'dividend_projection') {
			const summary = this.unifiedIntelligenceFacade.getPortfolioSummary({
				positions,
			});
			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: { dividendProjection: summary.dividendProjection },
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'benchmark_simple') {
			const summary = this.unifiedIntelligenceFacade.getPortfolioSummary({
				positions,
			});
			warnings.push('benchmark_simple_uses_portfolio_baseline_only');
			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: {
					portfolioSummary: {
						totalValue: summary.totalValue,
						diversification: summary.diversification,
					},
				},
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'asset_comparison' && symbols.length >= 2) {
			const comparison = await this.unifiedIntelligenceFacade.compareAssets({
				symbols,
				portfolioPositions: positions,
			});
			unavailable.push(...comparison.unavailableSymbols);
			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: { comparison },
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'asset_comparison' && symbols.length === 1) {
			const primarySymbol = symbols[0];
			const requestedPortfolioComparison =
				this.requestsPortfolioComparison(normalizedQuestion);
			const autoPeerSymbol = requestedPortfolioComparison
				? this.selectComparisonPeerFromPortfolio(primarySymbol, positions)
				: null;

			if (!autoPeerSymbol) {
				warnings.push('comparison_requires_two_assets');
				if (requestedPortfolioComparison) {
					warnings.push('portfolio_comparison_peer_unavailable');
				}
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: {},
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}

			const comparisonSymbols = [primarySymbol, autoPeerSymbol];
			const comparison = await this.unifiedIntelligenceFacade.compareAssets({
				symbols: comparisonSymbols,
				portfolioPositions: positions,
			});
			unavailable.push(...comparison.unavailableSymbols);
			warnings.push('comparison_peer_auto_selected_from_portfolio');
			assumptions.push(`comparison_peer_auto_selected:${autoPeerSymbol}`);

			const comparisonOwnedSymbols = comparisonSymbols.filter((symbol) =>
				bySymbol.has(this.normalizeTicker(symbol))
			);
			const comparisonExternalSymbols = comparisonSymbols.filter(
				(symbol) => !bySymbol.has(this.normalizeTicker(symbol))
			);

			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols: comparisonSymbols,
				ownedSymbols: comparisonOwnedSymbols,
				externalSymbols: comparisonExternalSymbols,
				positionsCount: positions.length,
				data: { comparison },
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		const primarySymbol = symbols[0] || null;

		if (intent === 'sell_simulation') {
			if (
				!primarySymbol ||
				!bySymbol.has(this.normalizeTicker(primarySymbol))
			) {
				if (primarySymbol) unavailable.push(primarySymbol);
				warnings.push('sell_simulation_requires_owned_asset');
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: {},
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}
			const position = bySymbol.get(this.normalizeTicker(primarySymbol))!;
			const parsed = this.parseSellInputs(normalizedQuestion);
			const snapshot =
				await this.marketDataProvider.getAssetSnapshot(primarySymbol);
			const sellPrice = parsed.sellPrice ?? snapshot?.price ?? null;
			if (sellPrice === null) {
				unavailable.push(primarySymbol);
				warnings.push('missing_sell_price_for_simulation');
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: { externalAsset: snapshot || null },
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}

			const quantityToSell =
				parsed.quantityToSell ??
				(parsed.sellHalfRequested
					? Number((position.quantity / 2).toFixed(8))
					: position.quantity);
			if (parsed.sellHalfRequested) {
				assumptions.push('sell_quantity_interpreted_as_half_position');
			} else if (parsed.quantityToSell === null) {
				assumptions.push('sell_quantity_defaulted_to_full_position');
			}
			const simulatedSellDate =
				parsed.simulatedSellDate || new Date().toISOString();
			if (!parsed.simulatedSellDate) {
				assumptions.push('simulated_sell_date_defaulted_to_current_date');
			}
			const currentTotalCost =
				typeof position.totalValue === 'number' && position.totalValue > 0
					? position.totalValue
					: Number(position.price || 0) * Number(position.quantity || 0);

			const sellSimulation = this.unifiedIntelligenceFacade.simulateSell({
				symbol: primarySymbol,
				assetType: position.assetType,
				quantityToSell,
				sellPrice,
				simulatedSellDate,
				currentPosition: {
					quantity: position.quantity,
					totalCost: currentTotalCost,
				},
			});

			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: { sellSimulation, externalAsset: snapshot || null },
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'tax_estimation') {
			if (this.isLossCompensationQuestion(normalizedQuestion)) {
				warnings.push('insufficient_history_for_loss_compensation');
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: {},
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}

			if (
				!primarySymbol ||
				!bySymbol.has(this.normalizeTicker(primarySymbol))
			) {
				if (primarySymbol) unavailable.push(primarySymbol);
				warnings.push('tax_estimation_requires_owned_asset');
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: {},
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}
			const position = bySymbol.get(this.normalizeTicker(primarySymbol))!;
			const parsed = this.parseSellInputs(normalizedQuestion);
			const snapshot =
				await this.marketDataProvider.getAssetSnapshot(primarySymbol);
			const sellPrice = snapshot?.price || null;
			if (sellPrice === null) {
				unavailable.push(primarySymbol);
				warnings.push('missing_sell_price_for_tax_estimation');
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: { externalAsset: snapshot || null },
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}
			const currentTotalCost =
				typeof position.totalValue === 'number' && position.totalValue > 0
					? position.totalValue
					: Number(position.price || 0) * Number(position.quantity || 0);
			const quantityToSell =
				parsed.quantityToSell ??
				(parsed.sellHalfRequested
					? Number((position.quantity / 2).toFixed(8))
					: position.quantity);
			const sellSimulation = this.unifiedIntelligenceFacade.simulateSell({
				symbol: primarySymbol,
				assetType: position.assetType,
				quantityToSell,
				sellPrice,
				simulatedSellDate: new Date().toISOString(),
				currentPosition: {
					quantity: position.quantity,
					totalCost: currentTotalCost,
				},
			});
			if (parsed.sellHalfRequested) {
				assumptions.push('tax_estimation_assumes_half_position_sell');
			} else {
				assumptions.push('tax_estimation_assumes_full_position_sell');
			}
			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: { sellSimulation, externalAsset: snapshot },
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'portfolio_fit_analysis' && primarySymbol) {
			const snapshot =
				await this.marketDataProvider.getAssetSnapshot(primarySymbol);
			if (!snapshot) {
				unavailable.push(primarySymbol);
				warnings.push('external_asset_data_unavailable');
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: {},
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}
			const normalizedSnapshotSymbol = this.normalizeTicker(
				snapshot.symbol || primarySymbol
			);
			const ownedPosition = bySymbol.get(normalizedSnapshotSymbol);
			const candidateValue =
				ownedPosition?.totalValue ||
				(snapshot.price ? Number(snapshot.price) : undefined) ||
				undefined;
			if (!candidateValue) {
				warnings.push('portfolio_fit_with_partial_candidate_value');
			}
			const portfolioFit = this.unifiedIntelligenceFacade.analyzeAssetFit({
				positions,
				candidate: {
					symbol: normalizedSnapshotSymbol,
					assetType: snapshot.assetType,
					quantity: ownedPosition?.quantity || 1,
					totalValue: candidateValue,
					currentPrice: snapshot.price || undefined,
					sector: snapshot.sector,
				},
			});
			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: { portfolioFit, externalAsset: snapshot },
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'external_asset_analysis' && primarySymbol) {
			const snapshot =
				await this.marketDataProvider.getAssetSnapshot(primarySymbol);
			if (!snapshot) {
				unavailable.push(primarySymbol);
				warnings.push('external_asset_data_unavailable');
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: {},
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}
			const normalizedSnapshotSymbol = this.normalizeTicker(
				snapshot.symbol || primarySymbol
			);
			const ownedPosition = bySymbol.get(normalizedSnapshotSymbol);
			if (ownedPosition) {
				warnings.push('asset_is_in_portfolio');
			} else {
				warnings.push('asset_not_in_portfolio');
			}
			if (snapshot.metadata.partial) {
				warnings.push('external_asset_data_partial');
			}
			if (snapshot.metadata.fallbackUsed) {
				warnings.push('external_asset_data_from_fallback');
			}
			const candidateValue =
				ownedPosition?.totalValue ||
				(snapshot.price ? Number(snapshot.price) : undefined) ||
				undefined;
			if (!candidateValue) {
				warnings.push('portfolio_fit_with_partial_candidate_value');
			}
			if (!snapshot.sector) {
				warnings.push('external_asset_sector_unavailable');
			}

			const portfolioFit = this.unifiedIntelligenceFacade.analyzeAssetFit({
				positions,
				candidate: {
					symbol: normalizedSnapshotSymbol,
					assetType: snapshot.assetType,
					quantity: ownedPosition?.quantity || 1,
					totalValue: candidateValue,
					currentPrice: snapshot.price || undefined,
					sector: snapshot.sector,
				},
			});
			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: { externalAsset: snapshot, portfolioFit },
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'opportunity_radar') {
			const opportunities =
				await this.unifiedIntelligenceFacade.detectOpportunities({
					portfolioPositions: positions,
					candidateSymbols: symbols.length ? symbols : undefined,
				});
			unavailable.push(...opportunities.unavailableSymbols);
			warnings.push(...opportunities.warnings);
			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: { opportunities },
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'future_scenario') {
			const horizon = this.parseFutureHorizon(normalizedQuestion);
			const monthlyContribution =
				this.parseMonthlyContribution(normalizedQuestion);
			const futureSimulation = this.unifiedIntelligenceFacade.simulateFuture({
				positions,
				horizon,
				monthlyContribution: monthlyContribution || undefined,
			});
			assumptions.push(
				`future_scenario_horizon:${horizon}`,
				'future_projection_is_estimate_not_guarantee'
			);
			if (monthlyContribution > 0) {
				assumptions.push(
					`future_scenario_monthly_contribution:${monthlyContribution}`
				);
			}
			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: {
					futureSimulation,
					dividendProjection: futureSimulation.dividendProjection,
				},
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'ri_summary' && primarySymbol) {
			if (!this.riDocumentQuery) {
				warnings.push('ri_document_provider_unavailable');
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: {},
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}
			const latestDocument =
				await this.riDocumentQuery.getLatestByTicker(primarySymbol);
			if (!latestDocument) {
				unavailable.push(primarySymbol);
				warnings.push('ri_document_not_found');
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: {},
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}
			const riSummary = await this.riDocumentSummaryService.summarize({
				document: latestDocument.document,
				content: latestDocument.content || '',
			});
			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: { riSummary },
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'ri_comparison' && primarySymbol) {
			if (!this.riDocumentQuery) {
				warnings.push('ri_document_provider_unavailable');
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: {},
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}
			const latestDocument =
				await this.riDocumentQuery.getLatestByTicker(primarySymbol);
			if (!latestDocument) {
				unavailable.push(primarySymbol);
				warnings.push('ri_document_not_found');
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: {},
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}
			const previousDocument =
				await this.riDocumentQuery.getPreviousComparable(latestDocument);
			if (!previousDocument) {
				warnings.push('ri_previous_document_not_found');
				const response = this.buildResponse({
					intent,
					routeType: 'deterministic_no_llm',
					routeReason: 'insufficient_structured_data',
					question: normalizedQuestion,
					symbols,
					ownedSymbols,
					externalSymbols,
					positionsCount: positions.length,
					data: {},
					unavailable,
					warnings,
					assumptions,
					cacheKey: canCache ? cacheKey : null,
					cacheHit,
					cacheTtlSeconds: canCache ? ttlSeconds : null,
				});
				await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
				this.safeRecordCost({
					routeType: response.route.type,
					cacheHit,
					llmEligible: response.route.llmEligible,
					estimatedLlmCallsAvoided: 0,
				});
				return response;
			}
			const currentSummary = await this.riDocumentSummaryService.summarize({
				document: latestDocument.document,
				content: latestDocument.content || '',
			});
			const previousSummary = await this.riDocumentSummaryService.summarize({
				document: previousDocument.document,
				content: previousDocument.content || '',
			});
			const riComparison = this.buildRiComparison(
				currentSummary,
				previousSummary
			);

			const response = this.buildResponse({
				intent,
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: { riComparison },
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		if (intent === 'narrative_synthesis') {
			const response = this.buildResponse({
				intent,
				routeType: 'synthesis_required',
				routeReason: 'narrative_requested',
				question: normalizedQuestion,
				symbols,
				ownedSymbols,
				externalSymbols,
				positionsCount: positions.length,
				data: {},
				unavailable,
				warnings,
				assumptions,
				cacheKey: canCache ? cacheKey : null,
				cacheHit,
				cacheTtlSeconds: canCache ? ttlSeconds : null,
			});
			await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
			this.safeRecordCost({
				routeType: response.route.type,
				cacheHit,
				llmEligible: response.route.llmEligible,
				estimatedLlmCallsAvoided: 0,
			});
			return response;
		}

		const response = this.buildResponse({
			intent: 'unknown',
			routeType: 'synthesis_required',
			routeReason: 'ambiguous_question',
			question: normalizedQuestion,
			symbols,
			ownedSymbols,
			externalSymbols,
			positionsCount: positions.length,
			data: {},
			unavailable,
			warnings,
			assumptions,
			cacheKey: canCache ? cacheKey : null,
			cacheHit,
			cacheTtlSeconds: canCache ? ttlSeconds : null,
		});
		await this.safeStoreCache(canCache, cacheKey, response, ttlSeconds);
		this.safeRecordCost({
			routeType: response.route.type,
			cacheHit,
			llmEligible: response.route.llmEligible,
			estimatedLlmCallsAvoided: 0,
		});
		return response;
	}

	private buildResponse(params: {
		intent: ChatOrchestratorIntent;
		routeType: ChatRouteType;
		routeReason:
			| 'rules_resolved'
			| 'insufficient_structured_data'
			| 'narrative_requested'
			| 'ambiguous_question';
		question: string;
		symbols: string[];
		ownedSymbols: string[];
		externalSymbols: string[];
		positionsCount: number;
		data: ChatOrchestratorResponse['data'];
		unavailable: string[];
		warnings: string[];
		assumptions: string[];
		cacheKey?: string | null;
		cacheHit?: boolean;
		cacheTtlSeconds?: number | null;
	}): ChatOrchestratorResponse {
		return {
			intent: params.intent,
			deterministic: true,
			route: {
				type: params.routeType,
				llmEligible: params.routeType === 'synthesis_required',
				reason: params.routeReason,
			},
			cache: {
				key: params.cacheKey ?? null,
				hit: params.cacheHit ?? false,
				ttlSeconds: params.cacheTtlSeconds ?? null,
			},
			cost: {
				llmCalls: 0,
				tokenUsageEstimate: 0,
				estimatedLlmCallsAvoidedByCache: 0,
			},
			question: params.question,
			context: {
				mentionedSymbols: params.symbols,
				ownedSymbols: params.ownedSymbols,
				externalSymbols: params.externalSymbols,
				positionsCount: params.positionsCount,
			},
			data: params.data,
			unavailable: Array.from(new Set(params.unavailable)),
			warnings: Array.from(new Set(params.warnings)),
			assumptions: Array.from(new Set(params.assumptions)),
		};
	}

	private async safeStoreCache(
		canCache: boolean,
		cacheKey: string,
		response: ChatOrchestratorResponse,
		ttlSeconds: number
	) {
		if (!canCache) return;
		try {
			await this.responseCache.set(cacheKey, response, ttlSeconds);
		} catch (_error) {
			// Safe degradation: cache is optional.
		}
	}

	private safeRecordCost(params: {
		routeType: 'deterministic_no_llm' | 'synthesis_required';
		cacheHit: boolean;
		llmEligible: boolean;
		estimatedLlmCallsAvoided: number;
	}) {
		try {
			this.costObserver.record({
				routeType: params.routeType,
				cacheHit: params.cacheHit,
				llmEligible: params.llmEligible,
				estimatedLlmCallsAvoided: params.estimatedLlmCallsAvoided,
			});
		} catch (_error) {
			// Observability must not break the main flow.
		}
	}

	private canCacheIntent(
		intent: ChatOrchestratorIntent,
		marketDataVersion: string
	): boolean {
		const marketSensitiveIntents: ChatOrchestratorIntent[] = [
			'sell_simulation',
			'tax_estimation',
			'asset_comparison',
			'external_asset_analysis',
			'portfolio_fit_analysis',
			'opportunity_radar',
			'future_scenario',
		];
		if (
			marketSensitiveIntents.includes(intent) &&
			marketDataVersion === 'market_unknown'
		) {
			return false;
		}
		return intent !== 'unknown';
	}

	private resolveCacheTtl(
		intent: ChatOrchestratorIntent,
		routeType: 'deterministic_no_llm' | 'synthesis_required'
	): number {
		if (routeType === 'synthesis_required') return 120;
		if (intent === 'portfolio_summary' || intent === 'portfolio_risk')
			return 120;
		if (intent === 'dividend_projection' || intent === 'benchmark_simple')
			return 180;
		if (intent === 'future_scenario') return 180;
		if (intent === 'opportunity_radar') return 90;
		if (intent === 'ri_summary' || intent === 'ri_comparison') return 120;
		if (intent === 'asset_comparison') return 90;
		if (intent === 'sell_simulation' || intent === 'tax_estimation') return 60;
		return 90;
	}

	private buildCacheKey(input: {
		question: string;
		portfolioHash: string;
		userPlan: string;
		marketDataVersion: string;
		responseMode: 'deterministic_no_llm' | 'synthesis_required';
	}): string {
		const normalizedQuestion = String(input.question || '')
			.trim()
			.toLowerCase()
			.replace(/\s+/g, ' ');
		return [
			`q:${normalizedQuestion}`,
			`p:${input.portfolioHash}`,
			`plan:${input.userPlan}`,
			`mv:${input.marketDataVersion}`,
			`mode:${input.responseMode}`,
		].join('|');
	}

	private computePortfolioHash(
		positions: PortfolioIntelligencePosition[]
	): string {
		const canonical = positions
			.map((position) => ({
				symbol: position.symbol,
				assetType: position.assetType,
				quantity: Number(position.quantity || 0),
				totalValue:
					typeof position.totalValue === 'number'
						? Number(position.totalValue)
						: null,
				sector: position.sector || null,
			}))
			.sort((a, b) => a.symbol.localeCompare(b.symbol));
		return createHash('sha256')
			.update(JSON.stringify(canonical))
			.digest('hex')
			.slice(0, 16);
	}

	private resolveUserPlan(portfolios: any[]): string {
		const rank = (value: string) => {
			switch ((value || '').toLowerCase()) {
				case 'global_investor':
					return 4;
				case 'premium':
					return 3;
				case 'pro':
					return 2;
				default:
					return 1;
			}
		};
		const plans = portfolios
			.map((item) => String(item?.plan || 'free').toLowerCase())
			.filter(Boolean);
		if (!plans.length) return 'free';
		return plans.sort((a, b) => rank(b) - rank(a))[0];
	}

	private resolveMarketDataVersion(input: {
		intent: ChatOrchestratorIntent;
		provided: string | null;
	}): string {
		const marketSensitiveIntents: ChatOrchestratorIntent[] = [
			'sell_simulation',
			'tax_estimation',
			'asset_comparison',
			'external_asset_analysis',
			'portfolio_fit_analysis',
			'opportunity_radar',
			'future_scenario',
		];
		if (!marketSensitiveIntents.includes(input.intent)) {
			return 'not_applicable';
		}
		const value = String(input.provided || '').trim();
		if (!value) return 'market_unknown';
		return value;
	}

	private classifyIntent(
		question: string,
		symbols: string[]
	): ChatOrchestratorIntent {
		const text = String(question || '').toLowerCase();
		if (
			/\b(explique|explica|estrategia|estratégia|detalhe|por que|porque)\b/.test(
				text
			)
		) {
			return 'narrative_synthesis';
		}
		if (
			/\b(ri|relacoes com investidores|relações com investidores)\b/.test(text)
		) {
			if (
				/\b(compare|comparar|comparacao|comparação|anterior|ultimo|último)\b/.test(
					text
				)
			) {
				return 'ri_comparison';
			}
			return 'ri_summary';
		}
		if (/\b(oportunidade|oportunidades|faixa atrativa|atrativa)\b/.test(text)) {
			return 'opportunity_radar';
		}
		if (
			/\b(quanto.*(5 anos|10 anos|1 ano|12 meses|6 meses)|projecao futura|projeção futura|cenario futuro|cenário futuro|quanto pode valer)\b/.test(
				text
			)
		) {
			return 'future_scenario';
		}
		if (
			symbols.length >= 2 ||
			/\b(vs|versus|comparar|compare|comparacao|comparação)\b/.test(text)
		) {
			return 'asset_comparison';
		}
		if (
			/\b(vender|venda|simular venda|simulacao de venda|simulação de venda)\b/.test(
				text
			)
		) {
			return 'sell_simulation';
		}
		if (
			/\b(imposto|tributa|taxa|ir|prejuizo|prejuízo|compens\w*)\b/.test(text)
		) {
			return 'tax_estimation';
		}
		if (
			/\b(dividendo|dividendos|projecao de dividendos|projeção de dividendos)\b/.test(
				text
			)
		) {
			return 'dividend_projection';
		}
		if (/\b(benchmark|cdi|ibov|ibovespa)\b/.test(text)) {
			return 'benchmark_simple';
		}
		if (/\b(risco|volatilidade|concentr\w*|exposicao|exposição)\b/.test(text)) {
			return 'portfolio_risk';
		}
		if (/\b(faz sentido|encaixe|fit|combina com minha carteira)\b/.test(text)) {
			return 'portfolio_fit_analysis';
		}
		if (
			/\b(carteira|portfolio|alocacao|alocação|resumo|aloc\w*)\b/.test(text)
		) {
			return 'portfolio_summary';
		}
		if (symbols.length >= 1) {
			return 'external_asset_analysis';
		}
		return 'unknown';
	}

	private requestsPortfolioComparison(question: string): boolean {
		const text = String(question || '').toLowerCase();
		return /\b(ja tenho|já tenho|minha carteira|meu portfolio|meu portfólio|meu ativo)\b/.test(
			text
		);
	}

	private selectComparisonPeerFromPortfolio(
		targetSymbol: string,
		positions: PortfolioIntelligencePosition[]
	): string | null {
		const normalizedTarget = this.normalizeTicker(targetSymbol);
		const candidates = positions.filter(
			(position) => this.normalizeTicker(position.symbol) !== normalizedTarget
		);
		if (!candidates.length) return null;

		const ranked = [...candidates].sort((a, b) => {
			const aValue = this.resolvePositionValue(a);
			const bValue = this.resolvePositionValue(b);
			return bValue - aValue;
		});
		return ranked[0]?.symbol || null;
	}

	private resolvePositionValue(
		position: PortfolioIntelligencePosition
	): number {
		if (typeof position.totalValue === 'number' && position.totalValue > 0) {
			return position.totalValue;
		}
		const inferred =
			Number(position.price || 0) * Number(position.quantity || 0);
		return Number.isFinite(inferred) && inferred > 0 ? inferred : 0;
	}

	private extractSymbols(question: string): string[] {
		const normalized = question.toUpperCase();
		const brSymbols = normalized.match(/\b[A-Z]{4}\d{1,2}\b/g) || [];
		const cryptoSymbols = normalized.match(/\b(BTC|ETH|SOL|ADA|XRP)\b/g) || [];
		const usSymbols = normalized.match(/\b[A-Z]{1,5}\.[A-Z]{1,3}\b/g) || [];

		const candidateSymbols = [
			...brSymbols,
			...cryptoSymbols,
			...usSymbols,
		].filter((symbol) => symbol.length >= 3 && !this.stopWords.has(symbol));
		return Array.from(
			new Set(candidateSymbols.map((symbol) => this.normalizeTicker(symbol)))
		)
			.filter(Boolean)
			.slice(0, 6);
	}

	private parseSellInputs(question: string): {
		quantityToSell: number | null;
		sellHalfRequested: boolean;
		sellPrice: number | null;
		simulatedSellDate: string | null;
	} {
		const normalized = String(question || '')
			.replace(',', '.')
			.trim();
		const halfRequested =
			/\b(metade|half|50%)\b/i.test(normalized) ||
			/\b(meia posicao|meia posição)\b/i.test(normalized);
		const quantityMatch =
			normalized.match(/\b(?:vender|venda|simular)\s+(\d+(?:\.\d+)?)\b/i) ||
			normalized.match(/\b(\d+(?:\.\d+)?)\s+(?:acoes|ações|cotas|unidades)\b/i);
		const priceMatch = normalized.match(
			/\b(?:a|por)\s*R?\$?\s*(\d+(?:\.\d+)?)\b/i
		);
		const dateMatch = normalized.match(
			/\b(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\b/
		);

		const quantityToSell = quantityMatch ? Number(quantityMatch[1]) : null;
		const sellPrice = priceMatch ? Number(priceMatch[1]) : null;
		const simulatedSellDate = dateMatch
			? this.toIsoDate(
					dateMatch[1].includes('/')
						? this.toIsoFromBrDate(dateMatch[1])
						: dateMatch[1]
				)
			: null;

		return {
			quantityToSell:
				quantityToSell && Number.isFinite(quantityToSell) && quantityToSell > 0
					? quantityToSell
					: null,
			sellHalfRequested: halfRequested,
			sellPrice:
				sellPrice && Number.isFinite(sellPrice) && sellPrice > 0
					? sellPrice
					: null,
			simulatedSellDate,
		};
	}

	private parseFutureHorizon(question: string): FutureSimulatorHorizon {
		const text = String(question || '').toLowerCase();
		if (/\b10\s*anos?\b/.test(text)) return '10y';
		if (/\b5\s*anos?\b/.test(text)) return '5y';
		if (/\b(1\s*ano|12\s*meses|proximo ano|próximo ano)\b/.test(text))
			return '1y';
		if (/\b6\s*meses\b/.test(text)) return '6m';
		return '1y';
	}

	private parseMonthlyContribution(question: string): number {
		const normalized = String(question || '').replace(',', '.');
		const match =
			normalized.match(
				/\baporte(?: mensal)?(?: de)?\s*r?\$?\s*(\d+(?:\.\d+)?)\b/i
			) ||
			normalized.match(
				/\binvest(?:ir|imento)?(?: mensal)?(?: de)?\s*r?\$?\s*(\d+(?:\.\d+)?)\b/i
			);
		if (!match) return 0;
		const value = Number(match[1]);
		return Number.isFinite(value) && value > 0 ? value : 0;
	}

	private buildRiComparison(
		current: RiDocumentSummaryOutput,
		previous: RiDocumentSummaryOutput
	) {
		const compareDirection = (
			currentDirection: 'up' | 'down' | 'neutral' | 'unknown',
			previousDirection: 'up' | 'down' | 'neutral' | 'unknown'
		): 'improved' | 'worsened' | 'stable' | 'unknown' => {
			if (currentDirection === 'unknown' || previousDirection === 'unknown') {
				return 'unknown';
			}
			if (currentDirection === previousDirection) return 'stable';
			if (currentDirection === 'up' && previousDirection === 'down')
				return 'improved';
			if (currentDirection === 'down' && previousDirection === 'up')
				return 'worsened';
			return 'stable';
		};

		return {
			status: 'compared',
			documents: {
				current: current.document,
				previous: previous.document,
			},
			differences: {
				guidance: compareDirection(
					current.structuredSignals.guidance.direction,
					previous.structuredSignals.guidance.direction
				),
				risks: compareDirection(
					current.structuredSignals.risks.direction,
					previous.structuredSignals.risks.direction
				),
				toneShift: compareDirection(
					current.structuredSignals.toneShift.direction,
					previous.structuredSignals.toneShift.direction
				),
				revenue: compareDirection(
					current.structuredSignals.revenue.direction,
					previous.structuredSignals.revenue.direction
				),
				profit: compareDirection(
					current.structuredSignals.profit.direction,
					previous.structuredSignals.profit.direction
				),
			},
			summaries: {
				current: current.summary,
				previous: previous.summary,
			},
		};
	}

	private isLossCompensationQuestion(question: string): boolean {
		const text = String(question || '').toLowerCase();
		return (
			/\b(prejuizo|prejuízo)\b/.test(text) && /\b(compens\w*)\b/.test(text)
		);
	}

	private toIsoFromBrDate(value: string): string {
		const [day, month, year] = value.split('/');
		return `${year}-${month}-${day}`;
	}

	private toIsoDate(value: string): string | null {
		const parsed = new Date(value);
		if (!Number.isFinite(parsed.getTime())) return null;
		return parsed.toISOString();
	}

	private toPositions(assets: any[]): PortfolioIntelligencePosition[] {
		return assets
			.map((asset: any) => ({
				symbol: this.normalizeTicker(
					asset?.symbol || asset?.ticker || asset?.stock || asset?.code || ''
				),
				assetType: (asset?.type || 'other') as
					| 'stock'
					| 'fii'
					| 'crypto'
					| 'etf'
					| 'fund'
					| 'other',
				quantity: Number(asset?.quantity || 0),
				totalValue:
					typeof asset?.total === 'number' && asset.total > 0
						? asset.total
						: undefined,
				price: typeof asset?.price === 'number' ? asset.price : undefined,
				currentPrice:
					typeof asset?.currentPrice === 'number'
						? asset.currentPrice
						: undefined,
				sector: typeof asset?.sector === 'string' ? asset.sector : null,
				volatility:
					typeof asset?.volatility === 'number' ? asset.volatility : undefined,
				beta: typeof asset?.beta === 'number' ? asset.beta : undefined,
			}))
			.filter((position) => !!position.symbol);
	}

	private normalizeTicker(value: string): string {
		const normalized = String(value || '')
			.trim()
			.toUpperCase()
			.replace(/\s+/g, '');
		if (!normalized) return '';
		const withNoDollar = normalized.replace(/^\$/, '');
		const brWithSuffix = withNoDollar.match(/^([A-Z]{4}\d{1,2})\.(SA|B3)$/);
		if (brWithSuffix) return brWithSuffix[1];
		return withNoDollar;
	}

	private readonly stopWords = new Set([
		'QUAL',
		'QUALE',
		'QUAIS',
		'COMPARE',
		'COMPARAR',
		'CARTEIRA',
		'PORTFOLIO',
		'RISCO',
		'DIVIDENDOS',
	]);
}
