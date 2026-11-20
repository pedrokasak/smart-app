import { AssetClass, Provenance, TransactionSide } from '../../domain/enums';

export const ADVISOR_SHARED_PORTFOLIO_SOURCE = Symbol(
	'ADVISOR_SHARED_PORTFOLIO_SOURCE'
);

export interface OwnedPortfolio {
	id: string;
	name: string;
}

export interface SharedHolding {
	symbol: string;
	assetClass: AssetClass;
	quantity: number;
	costMinor: number;
	provenance: Provenance;
}

export interface SharedTrade {
	symbol: string;
	assetClass: AssetClass;
	side: TransactionSide;
	quantity: number;
	unitPriceMinor: number;
	feesMinor: number;
	tradeDate: string;
	provenance: Provenance;
	createdAt: Date;
}

export interface SharedPortfolioData {
	portfolioId: string;
	name: string;
	holdings: SharedHolding[];
	trades: SharedTrade[];
}

export interface SharedPortfolioSourcePort {
	listOwned(userId: string): Promise<OwnedPortfolio[]>;
	/**
	 * Só devolve carteiras que pertencem a userId; ids desconhecidos ou de
	 * outro dono são omitidos.
	 */
	read(userId: string, portfolioIds: string[]): Promise<SharedPortfolioData[]>;
}
