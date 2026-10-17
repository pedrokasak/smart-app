import type {
	InvestmentPolicy,
	PortfolioPurpose,
} from 'src/portfolio/policy/domain/investment-policy';

export class PortfolioResponseDto {
	id: string;
	userId: string;
	cpf?: string | null;
	name: string;
	description?: string;
	ownerType: 'self' | 'spouse' | 'child' | 'other';
	ownerName?: string;
	totalValue: number;
	plan: string;
	purpose?: PortfolioPurpose | null;
	policy?: InvestmentPolicy | null;
	assetCount: number;
	syncedWithB3At?: Date;
	createdAt: Date;
	updatedAt: Date;
}
