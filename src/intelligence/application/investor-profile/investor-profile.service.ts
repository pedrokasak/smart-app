import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from 'src/users/schema/user.model';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { TradeModel } from 'src/fiscal/schema/trade.model';
import { InvestorProfileModel } from './schema/investor-profile.model';
import {
	computeConfidence,
	computeRiskTolerance,
	computeSophistication,
	isAdvancedInstrumentSymbol,
} from './investor-profile-signals';
import {
	InvestorProfileSignalsInput,
	InvestorSophisticationProfile,
	RiskToleranceLevel,
	SophisticationLevel,
} from './investor-profile.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * MS_PER_DAY;

@Injectable()
export class InvestorProfileService {
	constructor(
		@InjectModel('User') private readonly userModel: Model<User>,
		private readonly portfolioService: PortfolioService
	) {}

	async calculateAndPersist(userId: string): Promise<InvestorSophisticationProfile> {
		const signals = await this.collectSignals(userId);
		const sophistication = computeSophistication(signals);
		const riskTolerance = computeRiskTolerance(
			signals.variableIncomeAllocationPct
		);
		const confidence = computeConfidence(signals);

		const doc = await InvestorProfileModel.findOneAndUpdate(
			{ userId },
			{
				$set: {
					userId,
					sophistication,
					riskTolerance,
					confidence,
					signals,
					source: 'inferred',
				},
			},
			{ upsert: true, new: true }
		);

		return this.toEffectiveProfile(doc);
	}

	async getEffectiveProfile(userId: string): Promise<InvestorSophisticationProfile> {
		const doc = await InvestorProfileModel.findOne({ userId });
		if (!doc) {
			return this.calculateAndPersist(userId);
		}
		return this.toEffectiveProfile(doc);
	}

	async setOverride(
		userId: string,
		override: {
			sophistication?: SophisticationLevel;
			riskTolerance?: RiskToleranceLevel;
		}
	): Promise<InvestorSophisticationProfile> {
		const update: Record<string, unknown> = { userId };
		if (override.sophistication) {
			update.overriddenSophistication = override.sophistication;
		}
		if (override.riskTolerance) {
			update.overriddenRiskTolerance = override.riskTolerance;
		}
		const doc = await InvestorProfileModel.findOneAndUpdate(
			{ userId },
			{ $set: update },
			{ upsert: true, new: true }
		);
		return this.toEffectiveProfile(doc);
	}

	private toEffectiveProfile(doc: any): InvestorSophisticationProfile {
		const hasOverride = !!(
			doc.overriddenSophistication || doc.overriddenRiskTolerance
		);
		return {
			sophistication: doc.overriddenSophistication || doc.sophistication,
			riskTolerance: doc.overriddenRiskTolerance || doc.riskTolerance,
			confidence: doc.confidence,
			signals: doc.signals || {},
			source: hasOverride ? 'user_override' : 'inferred',
		};
	}

	private async collectSignals(
		userId: string
	): Promise<InvestorProfileSignalsInput> {
		const [user, portfolios, tradesLast12Months] = await Promise.all([
			this.userModel.findById(userId),
			this.portfolioService.getUserPortfolios(userId),
			TradeModel.countDocuments({
				userId,
				date: { $gte: new Date(Date.now() - ONE_YEAR_MS) },
			}),
		]);

		const assets = (portfolios || []).flatMap((p: any) =>
			Array.isArray(p?.assets) ? p.assets : []
		);

		const distinctSymbols = new Set<string>();
		const distinctSectors = new Set<string>();
		let variableIncomeValue = 0;
		let totalValue = 0;
		let hasAdvancedInstrument = false;

		for (const asset of assets) {
			const symbol = String(asset?.symbol || '').toUpperCase();
			if (symbol) distinctSymbols.add(symbol);
			if (asset?.sector) distinctSectors.add(String(asset.sector));

			const value =
				typeof asset?.total === 'number' && asset.total > 0
					? asset.total
					: Number(asset?.quantity || 0) *
						Number(asset?.currentPrice || asset?.price || 0);
			totalValue += value;
			if (asset?.type !== 'fund') {
				variableIncomeValue += value;
			}

			if (isAdvancedInstrumentSymbol(symbol, String(asset?.type || ''))) {
				hasAdvancedInstrument = true;
			}
		}

		const accountAgeDays = user?.createdAt
			? Math.floor((Date.now() - new Date(user.createdAt).getTime()) / MS_PER_DAY)
			: 0;

		return {
			distinctAssetCount: distinctSymbols.size,
			distinctSectorCount: distinctSectors.size,
			tradesLast12Months,
			accountAgeDays,
			variableIncomeAllocationPct:
				totalValue > 0 ? (variableIncomeValue / totalValue) * 100 : 0,
			hasAdvancedInstrument,
		};
	}
}
