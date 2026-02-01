export class PortfolioSummaryDto {
	id: string;
	name: string;
	ownerType: 'self' | 'spouse' | 'child' | 'other';
	ownerName?: string;
	totalValue: number;
	assetCount: number;
	plan: 'free' | 'premium' | 'pro';
	allocation: {
		symbol: string;
		quantity: number;
		percentage: number;
	}[];
}
