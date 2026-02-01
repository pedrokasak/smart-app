import { IsNotEmpty, IsStrongPassword } from 'class-validator';
import { Match } from 'src/utils/decorators';

export class ChangePasswordDto {
	@IsNotEmpty({ message: 'Current password is required' })
	currentPassword: string;

	@IsNotEmpty({ message: 'New password is required' })
	@IsStrongPassword({
		minLength: 8,
		minUppercase: 1,
		minLowercase: 1,
	})
	newPassword: string;

	@IsNotEmpty({ message: 'Confirm password is required' })
	@Match('newPassword', { message: 'Passwords do not match' })
	confirmPassword: string;
}
