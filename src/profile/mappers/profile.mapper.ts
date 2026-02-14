import { ProfileResponseDto } from 'src/profile/dto/profile-response.dto';
import { Profile } from 'src/profile/schema/profile.model';

export class ProfileMapper {
	static toResponseDto(
		profile: Profile | null | undefined
	): ProfileResponseDto {
		if (!profile) {
			throw new Error('Profile not found');
		}

		return {
			id: profile._id?.toString() || '',
			userId: profile.user?.toString() || '',
			phone: profile.phone || undefined,
			birthDate: profile.birthDate || undefined,
			address: profile.address
				? {
						street: profile.address.street,
						number: profile.address.number,
						complement: profile.address.complement,
						city: profile.address.city,
						state: profile.address.state,
						zipCode: profile.address.zipCode,
						country: profile.address.country,
					}
				: undefined,
			preferences: {
				language: profile.preferences?.language || 'pt-BR',
				theme: profile.preferences?.theme || 'light',
				notifications: profile.preferences?.notifications !== false,
				twoFactorEnabled: profile.preferences?.twoFactorEnabled || false,
			},
			maxPortfolios: profile.maxPortfolios || 3,
			isProfileComplete: profile.isProfileComplete || false,
			createdAt: profile.createdAt,
			updatedAt: profile.updatedAt,
		};
	}

	/**
	 * Converte um array de Profiles para array de ProfileResponseDto
	 */
	static toResponseDtoArray(
		profiles: Profile[] | null | undefined
	): ProfileResponseDto[] {
		if (!profiles || profiles.length === 0) {
			return [];
		}

		return profiles.map((profile) => this.toResponseDto(profile));
	}
}
