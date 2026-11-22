import { Injectable } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import { UsersService } from 'src/users/users.service';
import { PortalAccountDirectoryPort } from '../application/ports/portal-account-directory.port';

/** Lê as contas pelo serviço do módulo `users`, nunca pelo model. */
@Injectable()
export class UserPortalAccountDirectoryAdapter implements PortalAccountDirectoryPort {
	constructor(private readonly users: UsersService) {}

	async findUserIdByEmail(email: string): Promise<string | null> {
		if (typeof email !== 'string' || !email) return null;
		const user = await this.users.findByEmail(email);
		return user ? String(user._id) : null;
	}

	async findEmails(userIds: string[]): Promise<Map<string, string>> {
		const profiles = await this.findProfiles(userIds);
		return new Map([...profiles].map(([id, p]) => [id, p.email]));
	}

	/** Lê só `firstName`, `lastName` e `email` da conta. */
	async findProfiles(
		userIds: string[]
	): Promise<Map<string, { name: string; email: string }>> {
		const found = new Map<string, { name: string; email: string }>();
		await Promise.all(
			[...new Set(userIds)].filter(isValidObjectId).map(async (userId) => {
				const user = await this.users.findOne(userId);
				if (!user?.email) return;
				const name = [user.firstName, user.lastName]
					.filter((part): part is string => !!part?.trim())
					.map((part) => part.trim())
					.join(' ');
				found.set(userId, { name, email: user.email });
			})
		);
		return found;
	}
}
