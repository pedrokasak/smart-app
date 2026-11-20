import { Injectable } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import { UsersService } from 'src/users/users.service';
import {
	InviteeAccount,
	InviteeIdentityPort,
} from '../application/ports/invitee-identity.port';

/** Lê a conta pelo serviço do módulo `users`, nunca pelo model. */
@Injectable()
export class UserInviteeIdentityAdapter implements InviteeIdentityPort {
	constructor(private readonly users: UsersService) {}

	async find(userId: string): Promise<InviteeAccount | null> {
		if (typeof userId !== 'string' || !isValidObjectId(userId)) return null;
		const user = await this.users.findOne(userId);
		if (!user) return null;
		return {
			email: user.email,
			emailVerified: user.isEmailVerified === true,
		};
	}

	async markEmailVerified(userId: string, email: string): Promise<void> {
		await this.users.markEmailVerified(userId, email);
	}
}
