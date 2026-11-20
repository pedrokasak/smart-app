import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InviteStorePort } from '../application/ports/invite.store.port';
import { ClientInvite } from '../domain/consent.entities';
import { InviteStatus } from '../domain/enums';
import {
	ADVISOR_CLIENT_INVITE_MODEL,
	AdvisorClientInviteDoc,
} from './advisor-consent.models';
import { toClientInvite } from './advisor.mappers';

@Injectable()
export class MongoInviteStore implements InviteStorePort {
	constructor(
		@InjectModel(ADVISOR_CLIENT_INVITE_MODEL)
		private readonly invites: Model<AdvisorClientInviteDoc>
	) {}

	async create(
		invite: Omit<ClientInvite, 'id' | 'createdAt'>
	): Promise<ClientInvite> {
		const created = await this.invites.create(invite);
		return toClientInvite(created.toObject());
	}

	async findByTokenHash(tokenHash: string): Promise<ClientInvite | null> {
		const doc = await this.invites
			.findOne({ tokenHash })
			.lean<AdvisorClientInviteDoc>()
			.exec();
		return doc ? toClientInvite(doc) : null;
	}

	async findById(orgId: string, id: string): Promise<ClientInvite | null> {
		const doc = await this.invites
			.findOne({ _id: id, orgId })
			.lean<AdvisorClientInviteDoc>()
			.exec();
		return doc ? toClientInvite(doc) : null;
	}

	async findPendingByOrgAndEmail(
		orgId: string,
		email: string
	): Promise<ClientInvite[]> {
		const docs = await this.invites
			.find({ orgId, email, status: InviteStatus.Pending })
			.sort({ createdAt: 1, _id: 1 })
			.lean<AdvisorClientInviteDoc[]>()
			.exec();
		return docs.map(toClientInvite);
	}

	/** Um único `findOneAndUpdate` com PENDING no filtro: só um chamador ganha. */
	async transition(
		id: string,
		to: InviteStatus,
		at: Date
	): Promise<ClientInvite | null> {
		const doc = await this.invites
			.findOneAndUpdate(
				{ _id: id, status: InviteStatus.Pending },
				{ $set: { status: to, respondedAt: at } },
				{ new: true }
			)
			.lean<AdvisorClientInviteDoc>()
			.exec();
		return doc ? toClientInvite(doc) : null;
	}

	/** PENDING e `resendCount < max` no filtro; o hash antigo deixa de existir. */
	async rotateToken(
		id: string,
		tokenHash: string,
		expiresAt: Date,
		max: number
	): Promise<ClientInvite | null> {
		const doc = await this.invites
			.findOneAndUpdate(
				{ _id: id, status: InviteStatus.Pending, resendCount: { $lt: max } },
				{ $set: { tokenHash, expiresAt }, $inc: { resendCount: 1 } },
				{ new: true }
			)
			.lean<AdvisorClientInviteDoc>()
			.exec();
		return doc ? toClientInvite(doc) : null;
	}

	async deleteByEmail(email: string): Promise<number> {
		const result = await this.invites.deleteMany({ email }).exec();
		return result.deletedCount ?? 0;
	}

	async deleteByRelationshipIds(relationshipIds: string[]): Promise<number> {
		if (relationshipIds.length === 0) return 0;
		const result = await this.invites
			.deleteMany({ relationshipId: { $in: relationshipIds } })
			.exec();
		return result.deletedCount ?? 0;
	}
}
