import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MemberInviteStorePort } from '../application/ports/member-invite.store.port';
import { DuplicatePendingMemberInviteError } from '../application/ports/store-errors';
import { MemberInviteStatus } from '../domain/enums';
import { MemberInvite } from '../domain/team.entities';
import {
	ADVISOR_MEMBER_INVITE_MODEL,
	AdvisorMemberInviteDoc,
	MEMBER_INVITE_PENDING_EMAIL_INDEX,
} from './advisor-team.models';
import { toMemberInvite } from './advisor.mappers';
import { isDuplicateOnIndex } from './mongo-duplicate-key';

@Injectable()
export class MongoMemberInviteStore implements MemberInviteStorePort {
	constructor(
		@InjectModel(ADVISOR_MEMBER_INVITE_MODEL)
		private readonly invites: Model<AdvisorMemberInviteDoc>
	) {}

	/** Segundo PENDING do mesmo e-mail e org vira `DuplicatePendingMemberInviteError`. */
	async create(
		invite: Omit<MemberInvite, 'id' | 'createdAt'>
	): Promise<MemberInvite> {
		try {
			const created = await this.invites.create(invite);
			return toMemberInvite(created.toObject());
		} catch (error) {
			if (
				isDuplicateOnIndex(error, MEMBER_INVITE_PENDING_EMAIL_INDEX, [
					'orgId',
					'email',
				])
			) {
				throw new DuplicatePendingMemberInviteError();
			}
			throw error;
		}
	}

	async findById(orgId: string, id: string): Promise<MemberInvite | null> {
		const doc = await this.invites
			.findOne({ _id: id, orgId })
			.lean<AdvisorMemberInviteDoc>()
			.exec();
		return doc ? toMemberInvite(doc) : null;
	}

	async findByTokenHash(tokenHash: string): Promise<MemberInvite | null> {
		const doc = await this.invites
			.findOne({ tokenHash })
			.lean<AdvisorMemberInviteDoc>()
			.exec();
		return doc ? toMemberInvite(doc) : null;
	}

	async findPendingByOrgAndEmail(
		orgId: string,
		email: string,
		now: Date
	): Promise<MemberInvite | null> {
		const doc = await this.invites
			.findOne({
				orgId,
				email,
				status: MemberInviteStatus.Pending,
				expiresAt: { $gt: now },
			})
			.lean<AdvisorMemberInviteDoc>()
			.exec();
		return doc ? toMemberInvite(doc) : null;
	}

	async listPendingByOrg(orgId: string, now: Date): Promise<MemberInvite[]> {
		const docs = await this.invites
			.find({
				orgId,
				status: MemberInviteStatus.Pending,
				expiresAt: { $gt: now },
			})
			.sort({ createdAt: -1, _id: -1 })
			.limit(200)
			.lean<AdvisorMemberInviteDoc[]>()
			.exec();
		return docs.map(toMemberInvite);
	}

	/** Um único `findOneAndUpdate` com `from` no filtro: só um chamador ganha. */
	async transition(
		id: string,
		from: MemberInviteStatus,
		to: MemberInviteStatus,
		at: Date
	): Promise<MemberInvite | null> {
		// Voltar a PENDING desfaz a resposta: sem `respondedAt`.
		const update =
			to === MemberInviteStatus.Pending
				? { $set: { status: to }, $unset: { respondedAt: 1 } }
				: { $set: { status: to, respondedAt: at } };
		const doc = await this.invites
			.findOneAndUpdate({ _id: id, status: from }, update, { new: true })
			.lean<AdvisorMemberInviteDoc>()
			.exec();
		return doc ? toMemberInvite(doc) : null;
	}

	/** PENDING e abaixo do limite no filtro; o hash antigo deixa de existir. */
	async rotateToken(
		id: string,
		tokenHash: string,
		expiresAt: Date,
		max: number
	): Promise<MemberInvite | null> {
		const doc = await this.invites
			.findOneAndUpdate(
				{
					_id: id,
					status: MemberInviteStatus.Pending,
					resendCount: { $lt: max },
				},
				{ $set: { tokenHash, expiresAt }, $inc: { resendCount: 1 } },
				{ new: true }
			)
			.lean<AdvisorMemberInviteDoc>()
			.exec();
		return doc ? toMemberInvite(doc) : null;
	}

	async deleteById(id: string): Promise<void> {
		await this.invites.deleteOne({ _id: id }).exec();
	}

	async deleteByEmail(email: string): Promise<number> {
		const result = await this.invites.deleteMany({ email }).exec();
		return result.deletedCount ?? 0;
	}
}
