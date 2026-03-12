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
	assetCount: number;
	syncedWithB3At?: Date;
	createdAt: Date;
	updatedAt: Date;
}
