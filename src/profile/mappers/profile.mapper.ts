import { ProfileResponseDto } from 'src/profile/dto/profile-response.dto';
import { Profile } from 'src/profile/schema/profile.model';

export class ProfileMapper {
	static toResponseDto(profile: Profile): ProfileResponseDto {
		return {
			id: profile._id.toString(),
			userId: profile.user.toString(),
			phone: profile.phone,
			birthDate: profile.birthDate,
			address: profile.address,
			preferences: {
				language: profile.preferences?.language || 'pt-BR',
				theme: profile.preferences?.theme || 'light',
				notifications: profile.preferences?.notifications !== false,
				twoFactorEnabled: profile.preferences?.twoFactorEnabled || false,
			},
			maxPortfolios: profile.maxPortfolios,
			isProfileComplete: profile.isProfileComplete,
			createdAt: profile.createdAt,
			updatedAt: profile.updatedAt,
		};
	}
}
