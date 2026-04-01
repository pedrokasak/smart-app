import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResetPasswordDto } from './reset-password.dto';

describe('ResetPasswordDto', () => {
	it('should validate with strong password and confirmation', async () => {
		const dto = plainToInstance(ResetPasswordDto, {
			token: 'token-123',
			newPassword: 'Password123@',
			confirmPassword: 'Password123@',
		});

		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
	});

	it('should fail when new password is weak', async () => {
		const dto = plainToInstance(ResetPasswordDto, {
			token: 'token-123',
			newPassword: 'password',
			confirmPassword: 'password',
		});

		const errors = await validate(dto);
		const passwordError = errors.find(
			(error) => error.property === 'newPassword'
		);
		expect(passwordError?.constraints).toBeDefined();
	});

	it('should fail when confirmPassword is missing', async () => {
		const dto = plainToInstance(ResetPasswordDto, {
			token: 'token-123',
			newPassword: 'Password123@',
		});

		const errors = await validate(dto);
		const confirmError = errors.find(
			(error) => error.property === 'confirmPassword'
		);
		expect(confirmError?.constraints).toBeDefined();
	});
});
