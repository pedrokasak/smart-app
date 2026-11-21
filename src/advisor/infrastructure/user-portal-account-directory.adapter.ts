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
		const found = new Map<string, string>();
		await Promise.all(
			[...new Set(userIds)].filter(isValidObjectId).map(async (userId) => {
				const user = await this.users.findOne(userId);
				if (user?.email) found.set(userId, user.email);
			})
		);
		return found;
	}
}
