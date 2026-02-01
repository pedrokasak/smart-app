import { ProfileMapper } from 'src/profile/mappers/profile.mapper';
import { Profile } from 'src/profile/schema/profile.model';
import { UserResponseDto } from 'src/users/dto/user-response.dto';
import { UserWithProfileDto } from 'src/users/dto/user-with-profile.dto';
import { User } from 'src/users/schema/user.model';

export class UserMapper {
	static toResponseDto(user: User): UserResponseDto {
		return {
			id: user._id.toString(),
			email: user.email,
			firstName: user.firstName,
			lastName: user.lastName,
			avatar: user.avatar,
			isEmailVerified: user.isEmailVerified,
			isActive: user.isActive,
			lastLogin: user.lastLogin,
			createdAt: user.createdAt,
			userSubscription: user.userSubscription,
			updatedAt: user.updatedAt,
		};
	}

	static toUserWithProfileDto(
		user: User,
		profile: Profile
	): UserWithProfileDto {
		return {
			...this.toResponseDto(user),
			profile: ProfileMapper.toResponseDto(profile),
		};
	}
}
