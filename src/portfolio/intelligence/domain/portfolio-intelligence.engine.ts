import {
	AllocationEntry,
	AssetClass,
	ConcentrationEntry,
	PortfolioFitAnalysisOutput,
	PortfolioFitCandidateInput,
	PortfolioIntelligenceOutput,
	PortfolioIntelligencePosition,
	PortfolioIntelligenceRebalanceConfig,
	PortfolioIntelligenceThresholds,
	RebalanceSuggestionInputs,
	DividendFlowProjection,
} from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

const DEFAULT_THRESHOLDS: PortfolioIntelligenceThresholds = {
	highAssetConcentrationPct: 35,
	mediumAssetConcentrationPct: 20,
	highClassConcentrationPct: 60,
	mediumClassConcentrationPct: 40,
	highSectorConcentrationPct: 45,
	mediumSectorConcentrationPct: 25,
};

const SCORE_MAX = 100;

export class PortfolioIntelligenceEngine {
	private readonly thresholds: PortfolioIntelligenceThresholds;

	constructor(thresholds?: Partial<PortfolioIntelligenceThresholds>) {
		this.thresholds = {
			...DEFAULT_THRESHOLDS,
			...(thresholds || {}),
		};
	}

	analyze(
		positions: PortfolioIntelligencePosition[],
		rebalanceConfig?: PortfolioIntelligenceRebalanceConfig
	): PortfolioIntelligenceOutput {
		const normalized = positions
			.map((position) => ({
				...position,
				symbol: String(position.symbol || '')
					.trim()
					.toUpperCase(),
				sector: this.normalizeSector(position.sector),
				geography: this.normalizeGeography(position.geography),
				resolvedValue: this.resolvePositionValue(position),
			}))
			.filter((position) => position.resolvedValue > 0);

		const totalValue = normalized.reduce(
			(sum, position) => sum + position.resolvedValue,
			0
		);

		const allocationByClass = this.buildAllocation(
			normalized,
			(position) => this.mapAssetClass(position.assetType),
			totalValue
		);

		const allocationByAsset = this.buildAllocation(
			normalized,
			(position) => position.symbol || 'UNKNOWN',
			totalValue
		);
		const concentrationByAsset = this.toConcentration(allocationByAsset, 'asset');

		const concentrationBySector = this.toConcentration(
			this.buildAllocation(
				normalized,
				(position) => position.sector,
				totalValue
			),
			'sector'
		);
		const allocationByGeography = this.buildAllocation(
			normalized,
			(position) => position.geography,
			totalValue
		);

		const unknownSectorEntry = concentrationBySector.find(
			(entry) => entry.key === 'UNKNOWN'
		);
		const unknownSectorExposurePct = unknownSectorEntry?.percentage || 0;
		const unknownGeographyEntry = allocationByGeography.find(
			(entry) => entry.key === 'UNKNOWN'
		);
		const unknownGeographyExposurePct = unknownGeographyEntry?.percentage || 0;

		const diversification = this.computeDiversification(
			concentrationByAsset,
			allocationByClass,
			concentrationBySector,
			unknownSectorExposurePct
		);

		const risk = this.computeRisk(
			normalized,
			concentrationByAsset,
			allocationByClass,
			concentrationBySector,
			diversification.score,
			unknownSectorExposurePct
		);
		const dividendProjection = this.computeDividendProjection(
			normalized,
			allocationByClass,
			totalValue
		);
		const rebalanceSuggestionInputs = this.computeRebalanceSuggestionInputs(
			allocationByClass,
			concentrationByAsset,
			concentrationBySector,
			rebalanceConfig
		);

		return {
			facts: {
				totalValue,
				positionsCount: normalized.length,
				assetClassesCount: allocationByClass.length,
				sectorsCount: concentrationBySector.filter(
					(entry) => entry.key !== 'UNKNOWN'
				).length,
				geographiesCount: allocationByGeography.filter(
					(entry) => entry.key !== 'UNKNOWN'
				).length,
				unknownSectorExposurePct,
				unknownGeographyExposurePct,
				allocationByClass,
				allocationByAsset,
				allocationByGeography,
				concentrationByAsset,
				concentrationBySector,
			},
			rules: {
				thresholds: this.thresholds,
			},
			estimates: {
				diversification,
				risk,
				dividendProjection,
				rebalanceSuggestionInputs,
				riskModelVersion: 'heuristic_v1',
			},
		};
	}

	analyzePortfolioFit(
		positions: PortfolioIntelligencePosition[],
		candidate: PortfolioFitCandidateInput
	): PortfolioFitAnalysisOutput {
		const baseline = this.analyze(positions);
		const normalizedSymbol = String(candidate.symbol || '')
			.trim()
			.toUpperCase();
		const candidateValue = Number(
			this.resolvePositionValue({
				...candidate,
				symbol: normalizedSymbol,
			})
		);
		const candidateSector = this.normalizeSector(candidate.sector);
		const candidateAssetClass = this.mapAssetClass(candidate.assetType);
		const alreadyInPortfolio = positions.some(
			(position) =>
				String(position.symbol || '').trim().toUpperCase() === normalizedSymbol &&
				position.assetType === candidate.assetType
		);

		const mergedPositions =
			candidateValue > 0
				? this.mergeCandidateIntoPositions(positions, {
						...candidate,
						symbol: normalizedSymbol,
						totalValue: candidateValue,
					})
				: positions;
		const projected = this.analyze(mergedPositions);

		const allocationByClass = this.computeClassAllocationImpact(
			baseline.facts.allocationByClass,
			projected.facts.allocationByClass
		);

		const baselineSectorPct = this.findPercentageByKey(
			baseline.facts.concentrationBySector,
			candidateSector
		);
		const projectedSectorPct = this.findPercentageByKey(
			projected.facts.concentrationBySector,
			candidateSector
		);
		const diversificationImpact = {
			beforeScore: baseline.estimates.diversification.score,
			afterScore: projected.estimates.diversification.score,
			deltaScore: Number(
				(
					projected.estimates.diversification.score -
					baseline.estimates.diversification.score
				).toFixed(2)
			),
			beforeStatus: baseline.estimates.diversification.status,
			afterStatus: projected.estimates.diversification.status,
		};

		const hasCompleteMetadata = candidateSector !== 'UNKNOWN' && candidateValue > 0;
		const fit = this.resolvePortfolioFit({
			diversificationDelta: diversificationImpact.deltaScore,
			topAssetConcentrationDelta:
				this.findTopPercentage(projected.facts.concentrationByAsset) -
				this.findTopPercentage(baseline.facts.concentrationByAsset),
			topSectorConcentrationDelta:
				this.findTopKnownSectorPercentage(projected.facts.concentrationBySector) -
				this.findTopKnownSectorPercentage(baseline.facts.concentrationBySector),
			candidateSectorAfterPct: projectedSectorPct,
			hasCompleteMetadata,
		});

		const confidence = hasCompleteMetadata ? 'high' : 'low';

		return {
			candidate: {
				symbol: normalizedSymbol,
				assetClass: candidateAssetClass,
				sector: candidateSector,
				candidateValue: Number(candidateValue.toFixed(2)),
				alreadyInPortfolio,
				hasCompleteMetadata,
			},
			impact: {
				allocationByClass,
				sectorConcentration: {
					sector: candidateSector,
					beforePercentage: Number(baselineSectorPct.toFixed(2)),
					afterPercentage: Number(projectedSectorPct.toFixed(2)),
					deltaPercentage: Number((projectedSectorPct - baselineSectorPct).toFixed(2)),
				},
				diversification: diversificationImpact,
			},
			classification: fit.classification,
			confidence,
			signals: fit.signals,
		};
	}

	private resolvePositionValue(
		position: PortfolioIntelligencePosition
	): number {
		if (typeof position.totalValue === 'number' && position.totalValue > 0) {
			return position.totalValue;
		}

		const quantity = Number(position.quantity || 0);
		const currentPrice = Number(position.currentPrice || 0);
		if (quantity > 0 && currentPrice > 0) {
			return quantity * currentPrice;
		}

		const price = Number(position.price || 0);
		if (quantity > 0 && price > 0) {
			return quantity * price;
		}

		return 0;
	}

	private mapAssetClass(
		assetType: PortfolioIntelligencePosition['assetType']
	): AssetClass {
		switch (assetType) {
			case 'stock':
				return 'equities';
			case 'fii':
				return 'real_estate';
			case 'crypto':
				return 'crypto';
			case 'etf':
				return 'etf';
			case 'fund':
				return 'fund';
			default:
				return 'other';
		}
	}

	private normalizeSector(sector?: string | null): string {
		if (!sector || !sector.trim()) {
			return 'UNKNOWN';
		}

		return sector.trim().toUpperCase();
	}

	private normalizeGeography(geography?: string | null): string {
		if (!geography || !geography.trim()) {
			return 'UNKNOWN';
		}

		return geography.trim().toUpperCase();
	}

	private buildAllocation(
		positions: Array<
			PortfolioIntelligencePosition & { resolvedValue: number; sector: string }
		>,
		keyResolver: (
			position: PortfolioIntelligencePosition & {
				resolvedValue: number;
				sector: string;
			}
		) => string,
		totalValue: number
	): AllocationEntry[] {
		if (totalValue <= 0) {
			return [];
		}

		const buckets = new Map<string, number>();
		for (const position of positions) {
			const key = keyResolver(position);
			buckets.set(key, (buckets.get(key) || 0) + position.resolvedValue);
		}

		return Array.from(buckets.entries())
			.map(([key, value]) => ({
				key,
				value,
				percentage: (value / totalValue) * 100,
			}))
			.sort((a, b) => b.percentage - a.percentage);
	}

	private toConcentration(
		entries: AllocationEntry[],
		type: 'asset' | 'class' | 'sector'
	): ConcentrationEntry[] {
		return entries.map((entry) => ({
			...entry,
			severity: this.resolveSeverity(type, entry.percentage),
		}));
	}

	private resolveSeverity(
		type: 'asset' | 'class' | 'sector',
		percentage: number
	): 'low' | 'medium' | 'high' {
		const highThreshold =
			type === 'asset'
				? this.thresholds.highAssetConcentrationPct
				: type === 'class'
					? this.thresholds.highClassConcentrationPct
					: this.thresholds.highSectorConcentrationPct;

		const mediumThreshold =
			type === 'asset'
				? this.thresholds.mediumAssetConcentrationPct
				: type === 'class'
					? this.thresholds.mediumClassConcentrationPct
					: this.thresholds.mediumSectorConcentrationPct;

		if (percentage >= highThreshold) {
			return 'high';
		}
		if (percentage >= mediumThreshold) {
			return 'medium';
		}
		return 'low';
	}

	private computeDiversification(
		concentrationByAsset: ConcentrationEntry[],
		allocationByClass: AllocationEntry[],
		concentrationBySector: ConcentrationEntry[],
		unknownSectorExposurePct: number
	) {
		const assetSpread = this.spreadScore(
			concentrationByAsset.map((entry) => entry.percentage / 100)
		);
		const classSpread = this.spreadScore(
			allocationByClass.map((entry) => entry.percentage / 100)
		);
		const sectorSpread = this.spreadScore(
			concentrationBySector.map((entry) => entry.percentage / 100)
		);

		const unknownPenalty = Math.min(unknownSectorExposurePct * 0.3, 15);
		const composite =
			assetSpread * 0.5 + classSpread * 0.25 + sectorSpread * 0.25;
		const score = this.clampScore(composite - unknownPenalty);

		return {
			score,
			maxScore: SCORE_MAX,
			status: this.resolveDiversificationStatus(score),
			components: {
				assetSpread: this.clampScore(assetSpread),
				classSpread: this.clampScore(classSpread),
				sectorSpread: this.clampScore(sectorSpread),
			},
		};
	}

	private spreadScore(weights: number[]): number {
		const validWeights = weights.filter((weight) => weight > 0);
		const bucketCount = validWeights.length;
		if (bucketCount <= 1) {
			return 0;
		}

		const hhi = validWeights.reduce((sum, weight) => sum + weight * weight, 0);
		const normalized = (1 - hhi) / (1 - 1 / bucketCount);
		return this.clampScore(normalized * SCORE_MAX);
	}

	private resolveDiversificationStatus(
		score: number
	): 'poor' | 'moderate' | 'good' | 'excellent' {
		if (score < 40) {
			return 'poor';
		}
		if (score < 65) {
			return 'moderate';
		}
		if (score < 85) {
			return 'good';
		}
		return 'excellent';
	}

	private computeRisk(
		positions: Array<
			PortfolioIntelligencePosition & { resolvedValue: number; sector: string }
		>,
		concentrationByAsset: ConcentrationEntry[],
		allocationByClass: AllocationEntry[],
		concentrationBySector: ConcentrationEntry[],
		diversificationScore: number,
		unknownSectorExposurePct: number
	) {
		if (positions.length === 0) {
			return {
				score: 0,
				level: 'low' as const,
				flags: [],
			};
		}

		let score = 20;
		const flags: Array<{
			code: string;
			severity: 'low' | 'medium' | 'high';
			message: string;
		}> = [];

		const topAsset = concentrationByAsset[0];
		if (
			topAsset &&
			topAsset.percentage >= this.thresholds.highAssetConcentrationPct
		) {
			score += 30;
			flags.push({
				code: 'ASSET_CONCENTRATION_HIGH',
				severity: 'high',
				message: `Asset ${topAsset.key} exceeds high concentration threshold`,
			});
		} else if (
			topAsset &&
			topAsset.percentage >= this.thresholds.mediumAssetConcentrationPct
		) {
			score += 15;
			flags.push({
				code: 'ASSET_CONCENTRATION_MEDIUM',
				severity: 'medium',
				message: `Asset ${topAsset.key} has medium concentration`,
			});
		}

		const topClass = allocationByClass[0];
		if (
			topClass &&
			topClass.percentage >= this.thresholds.highClassConcentrationPct
		) {
			score += 20;
			flags.push({
				code: 'CLASS_CONCENTRATION_HIGH',
				severity: 'high',
				message: `Asset class ${topClass.key} exceeds high concentration threshold`,
			});
		}

		const topSector = concentrationBySector[0];
		if (
			topSector &&
			topSector.key !== 'UNKNOWN' &&
			topSector.percentage >= this.thresholds.highSectorConcentrationPct
		) {
			score += 20;
			flags.push({
				code: 'SECTOR_CONCENTRATION_HIGH',
				severity: 'high',
				message: `Sector ${topSector.key} exceeds high concentration threshold`,
			});
		} else if (
			topSector &&
			topSector.key !== 'UNKNOWN' &&
			topSector.percentage >= this.thresholds.mediumSectorConcentrationPct
		) {
			score += 10;
			flags.push({
				code: 'SECTOR_CONCENTRATION_MEDIUM',
				severity: 'medium',
				message: `Sector ${topSector.key} has medium concentration`,
			});
		}

		if (diversificationScore < 40) {
			score += 20;
			flags.push({
				code: 'DIVERSIFICATION_POOR',
				severity: 'high',
				message: 'Diversification score is poor',
			});
		} else if (diversificationScore < 65) {
			score += 10;
			flags.push({
				code: 'DIVERSIFICATION_MODERATE',
				severity: 'medium',
				message: 'Diversification score is moderate',
			});
		}

		if (unknownSectorExposurePct >= 35) {
			score += 10;
			flags.push({
				code: 'UNKNOWN_SECTOR_EXPOSURE_HIGH',
				severity: 'medium',
				message: 'High portfolio exposure without sector classification',
			});
		}

		const weightedVolatility = this.computeWeightedMetric(
			positions,
			(position) => Number(position.volatility || 0)
		);
		if (weightedVolatility >= 0.45) {
			score += 15;
			flags.push({
				code: 'VOLATILITY_HIGH',
				severity: 'high',
				message: 'Weighted volatility indicates high short-term variation risk',
			});
		} else if (weightedVolatility >= 0.3) {
			score += 8;
			flags.push({
				code: 'VOLATILITY_MEDIUM',
				severity: 'medium',
				message:
					'Weighted volatility indicates moderate short-term variation risk',
			});
		}

		const weightedBeta = this.computeWeightedMetric(positions, (position) =>
			Number(position.beta || 0)
		);
		if (weightedBeta >= 1.2) {
			score += 10;
			flags.push({
				code: 'BETA_HIGH',
				severity: 'medium',
				message: 'Portfolio beta suggests above-market sensitivity',
			});
		}

		score = this.clampScore(score);

		return {
			score,
			level: this.resolveRiskLevel(score),
			flags,
		};
	}

	private computeWeightedMetric(
		positions: Array<
			PortfolioIntelligencePosition & { resolvedValue: number; sector: string }
		>,
		metricResolver: (
			position: PortfolioIntelligencePosition & {
				resolvedValue: number;
				sector: string;
			}
		) => number
	): number {
		const totalValue = positions.reduce(
			(sum, position) => sum + position.resolvedValue,
			0
		);
		if (totalValue <= 0) {
			return 0;
		}

		let weighted = 0;
		for (const position of positions) {
			const metric = metricResolver(position);
			if (metric > 0) {
				weighted += (position.resolvedValue / totalValue) * metric;
			}
		}

		return weighted;
	}

	private resolveRiskLevel(score: number): 'low' | 'medium' | 'high' {
		if (score < 35) {
			return 'low';
		}
		if (score < 70) {
			return 'medium';
		}
		return 'high';
	}

	private clampScore(score: number): number {
		return Math.max(0, Math.min(SCORE_MAX, Number(score.toFixed(2))));
	}

	private computeDividendProjection(
		positions: Array<
			PortfolioIntelligencePosition & { resolvedValue: number; sector: string }
		>,
		allocationByClass: AllocationEntry[],
		totalValue: number
	): DividendFlowProjection {
		if (positions.length === 0 || totalValue <= 0) {
			return {
				modelVersion: 'deterministic_v1',
				projectedAnnualIncome: 0,
				projectedMonthlyIncome: 0,
				projectedYieldOnPortfolioPct: 0,
				coverage: {
					positionsWithData: 0,
					positionsWithoutData: 0,
					dataCoveragePct: 0,
				},
				byAssetClass: [],
			};
		}

		let projectedAnnualIncome = 0;
		let positionsWithData = 0;
		const classIncome = new Map<AssetClass, number>();

		for (const position of positions) {
			const annualIncome = this.resolveAnnualDividendIncome(position);
			if (annualIncome <= 0) {
				continue;
			}
			positionsWithData += 1;
			projectedAnnualIncome += annualIncome;
			const assetClass = this.mapAssetClass(position.assetType);
			classIncome.set(assetClass, (classIncome.get(assetClass) || 0) + annualIncome);
		}

		const projectedMonthlyIncome = projectedAnnualIncome / 12;
		const projectedYieldOnPortfolioPct =
			totalValue > 0 ? (projectedAnnualIncome / totalValue) * 100 : 0;
		const positionsWithoutData = Math.max(positions.length - positionsWithData, 0);
		const dataCoveragePct = (positionsWithData / positions.length) * 100;

		const classKeys = allocationByClass.map((entry) => entry.key as AssetClass);
		const byAssetClass = classKeys
			.map((assetClass) => {
				const annualIncome = classIncome.get(assetClass) || 0;
				const monthlyIncome = annualIncome / 12;
				const sharePct =
					projectedAnnualIncome > 0
						? (annualIncome / projectedAnnualIncome) * 100
						: 0;
				return {
					assetClass,
					annualIncome: Number(annualIncome.toFixed(2)),
					monthlyIncome: Number(monthlyIncome.toFixed(2)),
					sharePct: Number(sharePct.toFixed(2)),
				};
			})
			.filter((entry) => entry.annualIncome > 0);

		return {
			modelVersion: 'deterministic_v1',
			projectedAnnualIncome: Number(projectedAnnualIncome.toFixed(2)),
			projectedMonthlyIncome: Number(projectedMonthlyIncome.toFixed(2)),
			projectedYieldOnPortfolioPct: Number(projectedYieldOnPortfolioPct.toFixed(2)),
			coverage: {
				positionsWithData,
				positionsWithoutData,
				dataCoveragePct: Number(dataCoveragePct.toFixed(2)),
			},
			byAssetClass,
		};
	}

	private resolveAnnualDividendIncome(
		position: PortfolioIntelligencePosition & { resolvedValue: number; sector: string }
	): number {
		const quantity = Number(position.quantity || 0);
		if (quantity <= 0) {
			return 0;
		}

		const annualDividendPerUnit = Number(position.annualDividendPerUnit || 0);
		if (annualDividendPerUnit > 0) {
			return annualDividendPerUnit * quantity;
		}

		const trailingFromHistory = this.resolveTrailingDividendPerUnitFromHistory(
			position.dividendHistory
		);
		if (trailingFromHistory > 0) {
			return trailingFromHistory * quantity;
		}

		const normalizedDividendYield = this.normalizeDividendYield(position.dividendYield);
		if (normalizedDividendYield > 0 && position.resolvedValue > 0) {
			return normalizedDividendYield * position.resolvedValue;
		}

		return 0;
	}

	private resolveTrailingDividendPerUnitFromHistory(
		history?: Array<{ date: Date | string; value: number }>
	): number {
		if (!Array.isArray(history) || history.length === 0) {
			return 0;
		}

		const now = Date.now();
		const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
		let total = 0;
		for (const item of history) {
			const value = Number(item?.value || 0);
			if (value <= 0) continue;
			const timestamp = new Date(item?.date || 0).getTime();
			if (!Number.isFinite(timestamp) || timestamp < oneYearAgo || timestamp > now) {
				continue;
			}
			total += value;
		}

		return total;
	}

	private normalizeDividendYield(dividendYield?: number | null): number {
		if (typeof dividendYield !== 'number' || !Number.isFinite(dividendYield)) {
			return 0;
		}
		if (dividendYield <= 0) {
			return 0;
		}
		return dividendYield > 1 ? dividendYield / 100 : dividendYield;
	}

	private computeRebalanceSuggestionInputs(
		allocationByClass: AllocationEntry[],
		concentrationByAsset: ConcentrationEntry[],
		concentrationBySector: ConcentrationEntry[],
		rebalanceConfig?: PortfolioIntelligenceRebalanceConfig
	): RebalanceSuggestionInputs {
		const targetAllocationByClass = rebalanceConfig?.targetAllocationByClass;
		const hasTargetAllocation =
			!!targetAllocationByClass &&
			Object.keys(targetAllocationByClass).length > 0;

		const classAllocationSignals: RebalanceSuggestionInputs['classAllocationSignals'] =
			allocationByClass.map((entry) => {
				if (!hasTargetAllocation) {
					return {
						assetClass: entry.key as AssetClass,
						currentPercentage: Number(entry.percentage.toFixed(2)),
						targetPercentage: null,
						deltaPercentage: null,
						status: 'no_target',
					};
				}

				const target = Number(
					targetAllocationByClass?.[entry.key as AssetClass] ?? 0
				);
				const delta = Number((entry.percentage - target).toFixed(2));
				const absDelta = Math.abs(delta);
				const status =
					absDelta <= 0.5
						? 'aligned'
						: delta > 0
							? 'above_target'
							: 'below_target';

				return {
					assetClass: entry.key as AssetClass,
					currentPercentage: Number(entry.percentage.toFixed(2)),
					targetPercentage: Number(target.toFixed(2)),
					deltaPercentage: delta,
					status,
				};
			});

		const assetMaxConcentrationPct =
			typeof rebalanceConfig?.assetMaxConcentrationPct === 'number'
				? rebalanceConfig.assetMaxConcentrationPct
				: this.thresholds.highAssetConcentrationPct;

		const assetConcentrationSignals: RebalanceSuggestionInputs['assetConcentrationSignals'] =
			concentrationByAsset
				.filter((entry) => entry.percentage > assetMaxConcentrationPct)
				.map((entry) => ({
					type: 'asset',
					key: entry.key,
					status: 'above_limit' as const,
					severity: entry.severity,
					currentPercentage: Number(entry.percentage.toFixed(2)),
					minRecommendedPercentage: null,
					maxRecommendedPercentage: Number(assetMaxConcentrationPct.toFixed(2)),
				}));

		const globalSectorMax =
			typeof rebalanceConfig?.sectorMaxConcentrationPct === 'number'
				? rebalanceConfig.sectorMaxConcentrationPct
				: this.thresholds.highSectorConcentrationPct;

		const sectorLimitSignals: RebalanceSuggestionInputs['sectorLimitSignals'] =
			[];
		for (const entry of concentrationBySector) {
			if (entry.key === 'UNKNOWN') continue;

			const sectorConfig =
				rebalanceConfig?.sectorLimitsByKey?.[entry.key] || {};
			const minRecommended =
				typeof sectorConfig.minPct === 'number' ? sectorConfig.minPct : null;
			const maxRecommended =
				typeof sectorConfig.maxPct === 'number'
					? sectorConfig.maxPct
					: globalSectorMax;

			if (maxRecommended !== null && entry.percentage > maxRecommended) {
				sectorLimitSignals.push({
					type: 'sector',
					key: entry.key,
					status: 'above_limit',
					severity: entry.severity,
					currentPercentage: Number(entry.percentage.toFixed(2)),
					minRecommendedPercentage:
						minRecommended === null ? null : Number(minRecommended.toFixed(2)),
					maxRecommendedPercentage: Number(maxRecommended.toFixed(2)),
				});
				continue;
			}

			if (minRecommended !== null && entry.percentage < minRecommended) {
				sectorLimitSignals.push({
					type: 'sector',
					key: entry.key,
					status: 'below_limit',
					severity: 'medium',
					currentPercentage: Number(entry.percentage.toFixed(2)),
					minRecommendedPercentage: Number(minRecommended.toFixed(2)),
					maxRecommendedPercentage:
						maxRecommended === null ? null : Number(maxRecommended.toFixed(2)),
				});
			}
		}

		const exposureImbalances = [
			...assetConcentrationSignals,
			...sectorLimitSignals,
		];

		return {
			modelVersion: 'rebalance_inputs_v1',
			hasTargetAllocation,
			classAllocationSignals: hasTargetAllocation
				? classAllocationSignals.filter((entry) => entry.status !== 'aligned')
				: [],
			assetConcentrationSignals,
			sectorLimitSignals,
			exposureImbalances,
			hasRelevantSignals:
				exposureImbalances.length > 0 ||
				(hasTargetAllocation &&
					classAllocationSignals.some((entry) => entry.status !== 'aligned')),
		};
	}

	private mergeCandidateIntoPositions(
		positions: PortfolioIntelligencePosition[],
		candidate: PortfolioFitCandidateInput
	): PortfolioIntelligencePosition[] {
		const merged = positions.map((position) => ({ ...position }));
		const index = merged.findIndex(
			(position) =>
				String(position.symbol || '').trim().toUpperCase() === candidate.symbol &&
				position.assetType === candidate.assetType
		);

		if (index >= 0) {
			const current = merged[index];
			const currentValue = this.resolvePositionValue(current);
			merged[index] = {
				...current,
				quantity: Number(current.quantity || 0) + Math.max(Number(candidate.quantity || 0), 0),
				totalValue: Number((currentValue + Number(candidate.totalValue || 0)).toFixed(2)),
				sector:
					candidate.sector && candidate.sector.trim()
						? candidate.sector
						: current.sector || null,
				geography:
					candidate.geography && candidate.geography.trim()
						? candidate.geography
						: current.geography || null,
			};
			return merged;
		}

		merged.push({
			...candidate,
			quantity: Math.max(Number(candidate.quantity || 0), 1),
			totalValue: Number(Number(candidate.totalValue || 0).toFixed(2)),
			sector: candidate.sector || null,
			geography: candidate.geography || null,
		});
		return merged;
	}

	private computeClassAllocationImpact(
		before: AllocationEntry[],
		after: AllocationEntry[]
	): PortfolioFitAnalysisOutput['impact']['allocationByClass'] {
		const keys = new Set<string>([
			...before.map((entry) => entry.key),
			...after.map((entry) => entry.key),
		]);
		const output: PortfolioFitAnalysisOutput['impact']['allocationByClass'] = [];
		for (const key of keys) {
			const beforePercentage = this.findPercentageByKey(before, key);
			const afterPercentage = this.findPercentageByKey(after, key);
			output.push({
				assetClass: key as AssetClass,
				beforePercentage: Number(beforePercentage.toFixed(2)),
				afterPercentage: Number(afterPercentage.toFixed(2)),
				deltaPercentage: Number((afterPercentage - beforePercentage).toFixed(2)),
			});
		}
		return output.sort((a, b) => b.afterPercentage - a.afterPercentage);
	}

	private resolvePortfolioFit(input: {
		diversificationDelta: number;
		topAssetConcentrationDelta: number;
		topSectorConcentrationDelta: number;
		candidateSectorAfterPct: number;
		hasCompleteMetadata: boolean;
	}): {
		classification: PortfolioFitAnalysisOutput['classification'];
		signals: string[];
	} {
		if (!input.hasCompleteMetadata) {
			return {
				classification: 'neutro',
				signals: ['candidate_metadata_incomplete'],
			};
		}

		let score = 0;
		const signals: string[] = [];

		if (input.diversificationDelta >= 3) {
			score += 2;
			signals.push('diversification_improved');
		} else if (input.diversificationDelta <= -3) {
			score -= 2;
			signals.push('diversification_worsened');
		}

		if (input.topAssetConcentrationDelta <= -1.5) {
			score += 1;
			signals.push('asset_concentration_reduced');
		} else if (input.topAssetConcentrationDelta >= 1.5) {
			score -= 1;
			signals.push('asset_concentration_increased');
		}

		if (input.topSectorConcentrationDelta <= -1.5) {
			score += 1;
			signals.push('sector_concentration_reduced');
		} else if (input.topSectorConcentrationDelta >= 1.5) {
			score -= 3;
			signals.push('sector_concentration_increased');
		}

		if (input.candidateSectorAfterPct >= this.thresholds.highSectorConcentrationPct) {
			score -= 3;
			signals.push('candidate_sector_highly_concentrated');
		}

		if (score >= 2) {
			return { classification: 'bom', signals };
		}
		if (score <= -2) {
			return { classification: 'ruim', signals };
		}
		return { classification: 'neutro', signals };
	}

	private findPercentageByKey(
		entries: Array<{ key: string; percentage: number }>,
		key: string
	): number {
		const found = entries.find((entry) => entry.key === key);
		return found?.percentage || 0;
	}

	private findTopPercentage(entries: Array<{ percentage: number }>): number {
		if (entries.length === 0) return 0;
		return entries[0].percentage;
	}

	private findTopKnownSectorPercentage(
		entries: Array<{ key: string; percentage: number }>
	): number {
		const known = entries.filter((entry) => entry.key !== 'UNKNOWN');
		if (known.length === 0) return 0;
		return known[0].percentage;
	}
}

export { DEFAULT_THRESHOLDS };
