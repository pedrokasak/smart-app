import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordSecurityService {
	private readonly argon2Options: argon2.Options & { raw?: false } = {
		type: argon2.argon2id,
		// Balanced for a 4GB RAM server: resistant enough against GPU cracking
		// while keeping authentication latency reasonable in API flows.
		memoryCost: 64 * 1024, // 64 MiB
		timeCost: 3,
		parallelism: 1,
		hashLength: 32,
	};

	async hashPassword(password: string): Promise<string> {
		return argon2.hash(password, this.argon2Options);
	}

	async verifyPassword(password: string, storedHash: string): Promise<boolean> {
		if (!storedHash) return false;
		if (this.isBcryptHash(storedHash)) {
			return bcrypt.compare(password, storedHash);
		}

		try {
			return await argon2.verify(storedHash, password);
		} catch {
			return false;
		}
	}

	needsRehash(storedHash: string): boolean {
		if (!storedHash) return false;
		if (this.isBcryptHash(storedHash)) return true;
		try {
			return argon2.needsRehash(storedHash, this.argon2Options);
		} catch {
			return false;
		}
	}

	isBcryptHash(hash: string): boolean {
		return /^\$2[aby]\$\d{2}\$/.test(String(hash || ''));
	}
}
