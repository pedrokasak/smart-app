export class ProfileResponseDto {
	id: string;
	userId: string;
	cpf?: string;
	phone?: string;
	birthDate?: Date;
	address?: {
		street?: string;
		number?: string;
		complement?: string;
		city?: string;
		state?: string;
		zipCode?: string;
		country?: string;
	};
	preferences: {
		language: 'pt-BR' | 'en-US' | 'es-ES';
		theme: 'light' | 'dark';
		notifications: {
			email: boolean;
			push: boolean;
			marketAlerts: boolean;
			portfolioUpdates: boolean;
		};
		twoFactorEnabled: boolean;
	};
	maxPortfolios: number;
	isProfileComplete: boolean;
	createdAt: Date;
	updatedAt: Date;
}
