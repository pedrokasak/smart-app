import { Injectable } from '@nestjs/common';
import {
	FutureSimulatorInput,
	FutureSimulatorDividendProjectionOutput,
	FutureSimulatorOutput,
	FutureSimulatorScenarioOutput,
} from 'src/intelligence/application/unified-intelligence.types';
import { PortfolioIntelligencePosition } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';

@Injectable()
export class FutureSimulatorService {
	private readonly scenarioReturnsAnnualPct = {
		pessimistic: 0.02,
		base: 0.08,
		optimistic: 0.14,
	} as const;
	private readonly dividendGrowthAnnualPct = {
		pessimistic: 0,
		base: 0.04,
		optimistic: 0.08,
	} as const;

	simulate(input: FutureSimulatorInput): FutureSimulatorOutput {
		const months = this.resolveMonths(input.horizon);
		const monthlyContribution = Number(input.monthlyContribution || 0);
		const positions = input.positions || [];
		const { totalValue, coverageRatio } = this.resolveCurrentPortfolioValue(
			positions
		);
		const dividendProjection = this.buildDividendProjection(
			positions,
			months
		);

		const combinedCoverageRatio =
			coverageRatio * (dividendProjection.coverage.dataCoveragePct / 100 || 0);
		const confidence = this.resolveConfidence(coverageRatio);
		const dividendConfidence = this.resolveConfidence(
			dividendProjection.coverage.dataCoveragePct / 100
		);
		dividendProjection.confidence = dividendConfidence;

		const rangeBandPct = this.resolveRangeBand(confidence);
		const limitations: string[] = [];
		if (coverageRatio < 1) {
			limitations.push('future_simulator_partial_portfolio_data');
		}
		if (dividendProjection.coverage.dataCoveragePct < 100) {
			limitations.push('future_simulator_partial_dividend_data');
		}
		if (dividendProjection.coverage.positionsWithData === 0) {
			limitations.push('future_simulator_dividend_data_insufficient');
		}
		if (!totalValue) {
			limitations.push('future_simulator_low_current_value');
		}
		if (
			combinedCoverageRatio > 0 &&
			combinedCoverageRatio < 0.25 &&
			!limitations.includes('future_simulator_high_uncertainty')
		) {
			limitations.push('future_simulator_high_uncertainty');
		}

		const pessimistic = this.simulateScenario(
			'pessimistic',
			totalValue,
			months,
			monthlyContribution,
			this.scenarioReturnsAnnualPct.pessimistic,
			rangeBandPct,
			dividendProjection.scenarios.pessimistic
		);
		const base = this.simulateScenario(
			'base',
			totalValue,
			months,
			monthlyContribution,
			this.scenarioReturnsAnnualPct.base,
			rangeBandPct,
			dividendProjection.scenarios.base
		);
		const optimistic = this.simulateScenario(
			'optimistic',
			totalValue,
			months,
			monthlyContribution,
			this.scenarioReturnsAnnualPct.optimistic,
			rangeBandPct,
			dividendProjection.scenarios.optimistic
		);

		return {
			modelVersion: 'future_simulator_v1',
			horizon: input.horizon,
			months,
			currentPortfolioValue: totalValue,
			monthlyContribution,
			scenarios: {
				pessimistic,
				base,
				optimistic,
			},
			assumptions: {
				contributionFrequency: 'monthly',
				scenarioReturnsAnnualPct: {
					pessimistic: this.scenarioReturnsAnnualPct.pessimistic,
					base: this.scenarioReturnsAnnualPct.base,
					optimistic: this.scenarioReturnsAnnualPct.optimistic,
				},
			},
			dividendProjection,
			limitations,
			confidence,
		};
	}

	private simulateScenario(
		label: FutureSimulatorScenarioOutput['label'],
		currentValue: number,
		months: number,
		monthlyContribution: number,
		annualReturnPct: number,
		rangeBandPct: number,
		projectedDividendFlow: FutureSimulatorScenarioOutput['projectedDividendFlow']
	): FutureSimulatorScenarioOutput {
		const monthlyReturn = Math.pow(1 + annualReturnPct, 1 / 12) - 1;
		const growthFactor = Math.pow(1 + monthlyReturn, months);
		const projectedPrincipal = currentValue * growthFactor;
		const projectedContribution =
			monthlyContribution > 0
				? monthlyReturn > 0
					? monthlyContribution * ((growthFactor - 1) / monthlyReturn)
					: monthlyContribution * months
				: 0;
		const projectedValue = Math.max(
			0,
			Number((projectedPrincipal + projectedContribution).toFixed(2))
		);
		const lower = Math.max(0, Number((projectedValue * (1 - rangeBandPct)).toFixed(2)));
		const upper = Number((projectedValue * (1 + rangeBandPct)).toFixed(2));

		return {
			label,
			annualReturnPct,
			projectedValue,
			range: {
				lower,
				upper,
			},
			projectedDividendFlow: {
				monthly: Number(projectedDividendFlow.monthly.toFixed(2)),
				annual: Number(projectedDividendFlow.annual.toFixed(2)),
			},
		};
	}

	private buildDividendProjection(
		positions: PortfolioIntelligencePosition[],
		months: number
	): FutureSimulatorDividendProjectionOutput {
		if (!positions.length) {
			return {
				modelVersion: 'deterministic_dividend_projection_v1',
				current: {
					monthly: 0,
					annual: 0,
				},
				scenarios: {
					pessimistic: { monthly: 0, annual: 0 },
					base: { monthly: 0, annual: 0 },
					optimistic: { monthly: 0, annual: 0 },
				},
				coverage: {
					positionsWithData: 0,
					positionsWithoutData: 0,
					dataCoveragePct: 0,
				},
				confidence: 'low',
			};
		}

		let annualDividendCurrent = 0;
		let positionsWithData = 0;

		for (const position of positions) {
			const annualIncome = this.resolveAnnualDividendIncome(position);
			if (annualIncome <= 0) continue;
			annualDividendCurrent += annualIncome;
			positionsWithData += 1;
		}

		const positionsWithoutData = Math.max(positions.length - positionsWithData, 0);
		const dataCoveragePct = Number(
			((positionsWithData / positions.length) * 100).toFixed(2)
		);
		const years = months / 12;

		const pessimisticAnnual = this.projectAnnualDividend(
			annualDividendCurrent,
			this.dividendGrowthAnnualPct.pessimistic,
			years
		);
		const baseAnnual = this.projectAnnualDividend(
			annualDividendCurrent,
			this.dividendGrowthAnnualPct.base,
			years
		);
		const optimisticAnnual = this.projectAnnualDividend(
			annualDividendCurrent,
			this.dividendGrowthAnnualPct.optimistic,
			years
		);

		return {
			modelVersion: 'deterministic_dividend_projection_v1',
			current: {
				annual: Number(annualDividendCurrent.toFixed(2)),
				monthly: Number((annualDividendCurrent / 12).toFixed(2)),
			},
			scenarios: {
				pessimistic: {
					annual: pessimisticAnnual,
					monthly: Number((pessimisticAnnual / 12).toFixed(2)),
				},
				base: {
					annual: baseAnnual,
					monthly: Number((baseAnnual / 12).toFixed(2)),
				},
				optimistic: {
					annual: optimisticAnnual,
					monthly: Number((optimisticAnnual / 12).toFixed(2)),
				},
			},
			coverage: {
				positionsWithData,
				positionsWithoutData,
				dataCoveragePct,
			},
			confidence: 'medium',
		};
	}

	private projectAnnualDividend(
		baseAnnualDividend: number,
		growthRateAnnual: number,
		years: number
	): number {
		if (baseAnnualDividend <= 0) return 0;
		if (years <= 0) return Number(baseAnnualDividend.toFixed(2));
		return Number((baseAnnualDividend * Math.pow(1 + growthRateAnnual, years)).toFixed(2));
	}

	private resolveAnnualDividendIncome(position: PortfolioIntelligencePosition): number {
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
		const positionValue = this.resolvePositionValue(position) || 0;
		if (normalizedDividendYield > 0 && positionValue > 0) {
			return normalizedDividendYield * positionValue;
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

	private resolveMonths(horizon: FutureSimulatorInput['horizon']): number {
		switch (horizon) {
			case '6m':
				return 6;
			case '1y':
				return 12;
			case '5y':
				return 60;
			case '10y':
				return 120;
			default:
				return 12;
		}
	}

	private resolveCurrentPortfolioValue(positions: PortfolioIntelligencePosition[]): {
		totalValue: number;
		coverageRatio: number;
	} {
		if (!positions.length) {
			return { totalValue: 0, coverageRatio: 1 };
		}

		let covered = 0;
		let totalValue = 0;
		for (const position of positions) {
			const value = this.resolvePositionValue(position);
			if (value === null) continue;
			covered += 1;
			totalValue += value;
		}
		const coverageRatio = covered / positions.length;
		return {
			totalValue: Number(totalValue.toFixed(2)),
			coverageRatio: Number(coverageRatio.toFixed(4)),
		};
	}

	private resolvePositionValue(position: PortfolioIntelligencePosition): number | null {
		if (typeof position.totalValue === 'number' && position.totalValue > 0) {
			return position.totalValue;
		}
		const byCurrent = Number(position.currentPrice || 0) * Number(position.quantity || 0);
		if (byCurrent > 0) return byCurrent;
		const byPrice = Number(position.price || 0) * Number(position.quantity || 0);
		if (byPrice > 0) return byPrice;
		return null;
	}

	private resolveRangeBand(confidence: FutureSimulatorOutput['confidence']): number {
		switch (confidence) {
			case 'high':
				return 0.12;
			case 'medium':
				return 0.18;
			case 'low':
				return 0.25;
			default:
				return 0.18;
		}
	}

	private resolveConfidence(
		coverageRatio: number,
		secondaryCoverageRatio?: number
	): FutureSimulatorOutput['confidence'] {
		const effectiveCoverage =
			typeof secondaryCoverageRatio === 'number'
				? Math.min(coverageRatio, secondaryCoverageRatio)
				: coverageRatio;
		if (effectiveCoverage >= 0.9) return 'high';
		if (effectiveCoverage >= 0.6) return 'medium';
		return 'low';
	}
}
