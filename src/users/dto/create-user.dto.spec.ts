import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

describe('CreateUserDto', () => {
	const basePayload = {
		firstName: 'Pedro',
		lastName: 'SantAnna',
		email: 'pedro@example.com',
		confirmPassword: 'Password123@',
		avatar: 'http://example.com/avatar.png',
	};

	it('should validate with strong password', async () => {
		const dto = plainToInstance(CreateUserDto, {
			...basePayload,
			password: 'Password123@',
			confirmPassword: 'Password123@',
		});

		const errors = await validate(dto);
		expect(errors).toHaveLength(0);
	});

	it('should fail when password has no special character', async () => {
		const dto = plainToInstance(CreateUserDto, {
			...basePayload,
			password: 'Password1234',
			confirmPassword: 'Password1234',
		});

		const errors = await validate(dto);
		const passwordError = errors.find((error) => error.property === 'password');

		expect(passwordError?.constraints).toBeDefined();
		expect(Object.values(passwordError?.constraints || {})).toContain(
			'A senha deve conter pelo menos 1 caractere especial'
		);
	});

	it('should fail for weak password by other criteria', async () => {
		const dto = plainToInstance(CreateUserDto, {
			...basePayload,
			password: 'weak',
			confirmPassword: 'weak',
		});

		const errors = await validate(dto);
		const passwordError = errors.find((error) => error.property === 'password');

		expect(passwordError?.constraints).toBeDefined();
		expect(
			Object.values(passwordError?.constraints || {}).length
		).toBeGreaterThan(1);
	});
});
