import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from 'src/users/schema/user.model';
import {
	DEFAULT_INVESTMENT_POLICY,
	INVESTMENT_POLICY_HISTORY_LIMIT,
	InvestmentPolicy,
	findPolicyInconsistency,
} from './domain/investment-policy';

export interface InvestmentPolicyView {
	policy: InvestmentPolicy;
	isDefault: boolean;
	savedAt: string | null;
}

function toPolicy(version: InvestmentPolicy): InvestmentPolicy {
	return {
		maxAssetWeightPct: version.maxAssetWeightPct,
		maxSectorWeightPct: version.maxSectorWeightPct,
		fixedIncomeTargetPct: version.fixedIncomeTargetPct,
		brStocksTargetPct: version.brStocksTargetPct,
		maxCryptoPct: version.maxCryptoPct,
		benchmark: version.benchmark,
	};
}

@Injectable()
export class InvestmentPolicyService {
	constructor(@InjectModel('User') private readonly userModel: Model<User>) {}

	async get(userId: string): Promise<InvestmentPolicyView> {
		const user = await this.userModel
			.findById(userId)
			.select('investmentPolicy')
			.lean<Pick<User, 'investmentPolicy'> | null>();
		if (!user) throw new NotFoundException('Usuário não encontrado');

		const current = user.investmentPolicy;
		if (!current) {
			return { policy: DEFAULT_INVESTMENT_POLICY, isDefault: true, savedAt: null };
		}
		return {
			policy: toPolicy(current),
			isDefault: false,
			savedAt: new Date(current.savedAt).toISOString(),
		};
	}

	async save(
		userId: string,
		input: InvestmentPolicy
	): Promise<InvestmentPolicyView> {
		const policy = toPolicy(input);
		const inconsistency = findPolicyInconsistency(policy);
		if (inconsistency) throw new BadRequestException(inconsistency);

		const user = await this.userModel
			.findById(userId)
			.select('investmentPolicy')
			.lean<Pick<User, 'investmentPolicy'> | null>();
		if (!user) throw new NotFoundException('Usuário não encontrado');

		const savedAt = new Date();
		const update: Record<string, unknown> = {
			$set: { investmentPolicy: { ...policy, savedAt } },
		};
		// A versão substituída vai para o topo do histórico, que é aparado no
		// mesmo update para não crescer sem limite.
		if (user.investmentPolicy) {
			update.$push = {
				investmentPolicyHistory: {
					$each: [user.investmentPolicy],
					$position: 0,
					$slice: INVESTMENT_POLICY_HISTORY_LIMIT,
				},
			};
		}
		await this.userModel.updateOne({ _id: userId }, update);

		return { policy, isDefault: false, savedAt: savedAt.toISOString() };
	}

	async listVersions(
		userId: string
	): Promise<{ policy: InvestmentPolicy; savedAt: string }[]> {
		const user = await this.userModel
			.findById(userId)
			.select('+investmentPolicyHistory')
			.lean<Pick<User, 'investmentPolicyHistory'> | null>();
		if (!user) throw new NotFoundException('Usuário não encontrado');

		return (user.investmentPolicyHistory ?? []).map((version) => ({
			policy: toPolicy(version),
			savedAt: new Date(version.savedAt).toISOString(),
		}));
	}
}
