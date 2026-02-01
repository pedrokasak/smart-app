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
		notifications: boolean;
		twoFactorEnabled: boolean;
	};
	maxPortfolios: number;
	isProfileComplete: boolean;
	createdAt: Date;
	updatedAt: Date;
}
