import * as bcrypt from 'bcrypt';
import { PasswordSecurityService } from './password-security.service';

describe('PasswordSecurityService', () => {
	let service: PasswordSecurityService;

	beforeEach(() => {
		service = new PasswordSecurityService();
	});

	it('should hash and verify passwords using Argon2', async () => {
		const plain = 'Password123@';
		const hash = await service.hashPassword(plain);

		expect(hash.startsWith('$argon2id$')).toBe(true);
		expect(await service.verifyPassword(plain, hash)).toBe(true);
		expect(await service.verifyPassword('Wrong123@', hash)).toBe(false);
	});

	it('should verify legacy bcrypt hash and require rehash', async () => {
		const plain = 'Password123@';
		const bcryptHash = await bcrypt.hash(plain, 10);

		expect(await service.verifyPassword(plain, bcryptHash)).toBe(true);
		expect(service.needsRehash(bcryptHash)).toBe(true);
	});

	it('should not require rehash for fresh argon2 hash', async () => {
		const hash = await service.hashPassword('Password123@');
		expect(service.needsRehash(hash)).toBe(false);
	});
});
