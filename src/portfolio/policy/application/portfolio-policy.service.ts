import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { CreatePortfolioDto } from 'src/portfolio/dto/create-portfolio.dto';
import type { Portfolio } from 'src/portfolio/schema/portfolio.model';
import {
	InvalidPolicyError,
	PortfolioPolicy,
	normalizePolicy,
	PortfolioPurpose,
	PurposeOption,
	purposeOptions,
	suggestedPolicy,
} from '../domain/portfolio-policy';

export type ResolvedPortfolioPolicy = {
	purpose: PortfolioPurpose | null;
	policy: PortfolioPolicy | null;
};

export type PrimaryPolicy = {
	portfolioId: string;
	name: string;
	policy: PortfolioPolicy;
};

export type PolicySuggestions = {
	purposes: PurposeOption[];
	/** O que "usar a mesma política da carteira principal" copiaria. */
	primary: PrimaryPolicy | null;
};

type PolicyDoc = {
	_id: unknown;
	name: string;
	policy: PortfolioPolicy;
};

/**
 * Decide a finalidade e a política gravadas numa carteira nova (TRA-106).
 *
 * "Carteira principal" é a mais antiga do usuário que já tem política:
 * carteiras criadas antes do assistente não têm, e copiar `null` não faz
 * sentido.
 */
@Injectable()
export class PortfolioPolicyService {
	constructor(
		@InjectModel('Portfolio') private readonly portfolioModel: Model<Portfolio>
	) {}

	async suggestions(userId: string): Promise<PolicySuggestions> {
		return { purposes: purposeOptions(), primary: await this.primary(userId) };
	}

	async resolveForCreate(
		userId: string,
		dto: Pick<CreatePortfolioDto, 'purpose' | 'policy' | 'inheritPrimaryPolicy'>
	): Promise<ResolvedPortfolioPolicy> {
		const purpose = dto.purpose ?? null;

		if (dto.policy) {
			return { purpose, policy: this.normalize(dto.policy) };
		}
		if (dto.inheritPrimaryPolicy) {
			const primary = await this.primary(userId);
			if (primary) return { purpose, policy: primary.policy };
		}
		// Sem finalidade (sincronização de corretora, fluxos antigos) a
		// carteira nasce sem política, como antes.
		return { purpose, policy: purpose ? suggestedPolicy(purpose) : null };
	}

	private async primary(userId: string): Promise<PrimaryPolicy | null> {
		const doc = await this.portfolioModel
			.findOne({ userId, policy: { $ne: null } })
			.sort({ createdAt: 1 })
			.select('name policy')
			.lean<PolicyDoc | null>();
		if (!doc?.policy) return null;
		try {
			return {
				portfolioId: String(doc._id),
				name: doc.name,
				policy: normalizePolicy(doc.policy),
			};
		} catch {
			// Documento fora das regras atuais: melhor não oferecer a cópia.
			return null;
		}
	}

	private normalize(policy: PortfolioPolicy): PortfolioPolicy {
		try {
			return normalizePolicy(policy);
		} catch (error) {
			if (error instanceof InvalidPolicyError) {
				throw new BadRequestException(error.message);
			}
			throw error;
		}
	}
}
