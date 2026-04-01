import { Injectable } from '@nestjs/common';
import { PortfolioIntelligenceEngine } from 'src/portfolio/intelligence/domain/portfolio-intelligence.engine';
import {
	PortfolioFitAnalysisOutput,
	PortfolioFitCandidateInput,
	PortfolioIntelligenceOutput,
	PortfolioIntelligencePosition,
	PortfolioIntelligenceRebalanceConfig,
	PortfolioIntelligenceThresholds,
} from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

export interface PortfolioAssetInput {
	symbol: string;
	type: 'stock' | 'fii' | 'crypto' | 'etf' | 'fund' | 'other';
	quantity: number;
	total?: number;
	price?: number;
	currentPrice?: number;
	sector?: string | null;
	geography?: string | null;
	volatility?: number | null;
	beta?: number | null;
	dividendYield?: number | null;
	annualDividendPerUnit?: number | null;
	dividendHistory?: Array<{
		date: Date | string;
		value: number;
	}>;
}

export interface PortfolioFitAssetCandidateInput extends PortfolioAssetInput {}

@Injectable()
export class PortfolioIntelligenceService {
	analyzePositions(
		positions: PortfolioIntelligencePosition[],
		thresholds?: Partial<PortfolioIntelligenceThresholds>,
		rebalanceConfig?: PortfolioIntelligenceRebalanceConfig
	): PortfolioIntelligenceOutput {
		const engine = new PortfolioIntelligenceEngine(thresholds);
		return engine.analyze(positions, rebalanceConfig);
	}

	analyzeAssets(
		assets: PortfolioAssetInput[],
		thresholds?: Partial<PortfolioIntelligenceThresholds>,
		rebalanceConfig?: PortfolioIntelligenceRebalanceConfig
	): PortfolioIntelligenceOutput {
		const positions: PortfolioIntelligencePosition[] = assets.map((asset) => ({
			symbol: asset.symbol,
			assetType: asset.type,
			quantity: Number(asset.quantity || 0),
			totalValue:
				typeof asset.total === 'number' && asset.total > 0
					? asset.total
					: undefined,
			price: typeof asset.price === 'number' ? asset.price : undefined,
			currentPrice:
				typeof asset.currentPrice === 'number' ? asset.currentPrice : undefined,
			sector: asset.sector || null,
			geography: asset.geography || null,
			volatility:
				typeof asset.volatility === 'number' ? asset.volatility : undefined,
			beta: typeof asset.beta === 'number' ? asset.beta : undefined,
			dividendYield:
				typeof asset.dividendYield === 'number'
					? asset.dividendYield
					: undefined,
			annualDividendPerUnit:
				typeof asset.annualDividendPerUnit === 'number'
					? asset.annualDividendPerUnit
					: undefined,
			dividendHistory: Array.isArray(asset.dividendHistory)
				? asset.dividendHistory
				: undefined,
		}));

		return this.analyzePositions(positions, thresholds, rebalanceConfig);
	}

	analyzePortfolioFit(
		positions: PortfolioIntelligencePosition[],
		candidate: PortfolioFitCandidateInput,
		thresholds?: Partial<PortfolioIntelligenceThresholds>
	): PortfolioFitAnalysisOutput {
		const engine = new PortfolioIntelligenceEngine(thresholds);
		return engine.analyzePortfolioFit(positions, candidate);
	}

	analyzeAssetPortfolioFit(
		assets: PortfolioAssetInput[],
		candidate: PortfolioFitAssetCandidateInput,
		thresholds?: Partial<PortfolioIntelligenceThresholds>
	): PortfolioFitAnalysisOutput {
		const positions = assets.map((asset) => this.mapAssetToPosition(asset));
		const candidatePosition = this.mapAssetToPosition(candidate);
		return this.analyzePortfolioFit(positions, candidatePosition, thresholds);
	}

	private mapAssetToPosition(
		asset: PortfolioAssetInput
	): PortfolioIntelligencePosition {
		return {
			symbol: asset.symbol,
			assetType: asset.type,
			quantity: Number(asset.quantity || 0),
			totalValue:
				typeof asset.total === 'number' && asset.total > 0
					? asset.total
					: undefined,
			price: typeof asset.price === 'number' ? asset.price : undefined,
			currentPrice:
				typeof asset.currentPrice === 'number' ? asset.currentPrice : undefined,
			sector: asset.sector || null,
			geography: asset.geography || null,
			volatility:
				typeof asset.volatility === 'number' ? asset.volatility : undefined,
			beta: typeof asset.beta === 'number' ? asset.beta : undefined,
			dividendYield:
				typeof asset.dividendYield === 'number'
					? asset.dividendYield
					: undefined,
			annualDividendPerUnit:
				typeof asset.annualDividendPerUnit === 'number'
					? asset.annualDividendPerUnit
					: undefined,
			dividendHistory: Array.isArray(asset.dividendHistory)
				? asset.dividendHistory
				: undefined,
		};
	}
}
