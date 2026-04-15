import { validate } from 'class-validator';
import { AuthenticateDto } from 'src/authentication/dto/authenticate.dto';

describe('AuthenticateDto security validation', () => {
	it('rejects overly long email and password payloads', async () => {
		const dto = new AuthenticateDto();
		dto.email = `${'a'.repeat(300)}@example.com`;
		dto.password = 'x'.repeat(200);
		dto.keepConnected = false;
		dto.token = '' as any;

		const errors = await validate(dto);
		const fields = errors.map((error) => error.property);

		expect(fields).toContain('email');
		expect(fields).toContain('password');
	});
});
