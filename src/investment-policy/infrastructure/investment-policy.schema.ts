import { Schema } from 'mongoose';
import {
	INVESTMENT_BENCHMARKS,
	InvestmentPolicy,
} from 'src/investment-policy/domain/investment-policy';

export interface InvestmentPolicyVersion extends InvestmentPolicy {
	savedAt: Date;
}

const percent = { type: Number, required: true, min: 0, max: 100 };

export const investmentPolicyVersionSchema =
	new Schema<InvestmentPolicyVersion>(
		{
			maxAssetWeightPct: percent,
			maxSectorWeightPct: percent,
			fixedIncomeTargetPct: percent,
			brStocksTargetPct: percent,
			maxCryptoPct: percent,
			benchmark: { type: String, enum: INVESTMENT_BENCHMARKS, required: true },
			savedAt: { type: Date, required: true },
		},
		{ _id: false }
	);
