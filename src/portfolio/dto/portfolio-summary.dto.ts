export class PortfolioSummaryDto {
	id: string;
	name: string;
	ownerType: 'self' | 'spouse' | 'child' | 'other';
	ownerName?: string;
	totalValue: number;
	assetCount: number;
	plan: string;
	allocation: {
		symbol: string;
		quantity: number;
		percentage: number;
	}[];
}
