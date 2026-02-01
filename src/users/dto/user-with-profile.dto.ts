import { ProfileResponseDto } from 'src/profile/dto/profile-response.dto';
import { UserResponseDto } from 'src/users/dto/user-response.dto';

export class UserWithProfileDto extends UserResponseDto {
	profile: ProfileResponseDto;
}
