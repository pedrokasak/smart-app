import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model, ModifyResult } from 'mongoose';
import {
	AssignedClientsPage,
	AssignResult,
	AssignmentStorePort,
	ListAssignedClientsQuery,
} from '../application/ports/assignment.store.port';
import {
	decodeRelationshipCursor,
	encodeRelationshipCursor,
} from '../application/relationship-cursor';
import { ClientAssignment } from '../domain/team.entities';
import {
	ADVISOR_CLIENT_ASSIGNMENT_MODEL,
	ASSIGNMENT_UNIQUE_INDEX,
	AdvisorClientAssignmentDoc,
} from './advisor-team.models';
import { toClientAssignment } from './advisor.mappers';
import { isDuplicateOnIndex } from './mongo-duplicate-key';

@Injectable()
export class MongoAssignmentStore implements AssignmentStorePort {
	constructor(
		@InjectModel(ADVISOR_CLIENT_ASSIGNMENT_MODEL)
		private readonly assignments: Model<AdvisorClientAssignmentDoc>
	) {}

	/**
	 * Upsert pelo trio único: só grava `assignedBy` e `_id` na inserção, então
	 * repetir devolve a atribuição original (`created` false). Se duas
	 * chamadas inserem juntas, a perdedora leva E11000 do índice, relê a
	 * vencedora e também devolve `created` false.
	 */
	async assign(
		orgId: string,
		clientProfileId: string,
		userId: string,
		assignedBy: string
	): Promise<AssignResult> {
		const filter = { orgId, clientProfileId, userId };
		try {
			const result = await this.assignments
				.findOneAndUpdate(
					filter,
					{ $setOnInsert: { _id: randomUUID(), assignedBy } },
					{ new: true, upsert: true, includeResultMetadata: true }
				)
				.lean<ModifyResult<AdvisorClientAssignmentDoc>>()
				.exec();
			if (!result.value) throw new Error('Assignment upsert returned no row');
			return {
				assignment: toClientAssignment(result.value),
				created: result.lastErrorObject?.updatedExisting === false,
			};
		} catch (error) {
			if (
				!isDuplicateOnIndex(error, ASSIGNMENT_UNIQUE_INDEX, [
					'orgId',
					'clientProfileId',
					'userId',
				])
			) {
				throw error;
			}
			const existing = await this.assignments
				.findOne(filter)
				.lean<AdvisorClientAssignmentDoc>()
				.exec();
			if (!existing) throw error;
			return { assignment: toClientAssignment(existing), created: false };
		}
	}

	async unassign(
		orgId: string,
		clientProfileId: string,
		userId: string
	): Promise<boolean> {
		const result = await this.assignments
			.deleteOne({ orgId, clientProfileId, userId })
			.exec();
		return (result.deletedCount ?? 0) > 0;
	}

	async isAssigned(
		orgId: string,
		clientProfileId: string,
		userId: string
	): Promise<boolean> {
		const found = await this.assignments
			.exists({ orgId, clientProfileId, userId })
			.exec();
		return found !== null;
	}

	async listByClient(
		orgId: string,
		clientProfileId: string
	): Promise<ClientAssignment[]> {
		const docs = await this.assignments
			.find({ orgId, clientProfileId })
			.sort({ createdAt: 1, _id: 1 })
			.lean<AdvisorClientAssignmentDoc[]>()
			.exec();
		return docs.map(toClientAssignment);
	}

	/** Busca `limit + 1` linhas: a sobra diz se há próxima página. */
	async listClientIdsByUser(
		orgId: string,
		userId: string,
		query: ListAssignedClientsQuery
	): Promise<AssignedClientsPage> {
		const filter: Record<string, unknown> = { orgId, userId };
		if (query.cursor) {
			const { createdAt, id } = decodeRelationshipCursor(query.cursor);
			filter.$or = [
				{ createdAt: { $gt: createdAt } },
				{ createdAt, _id: { $gt: id } },
			];
		}
		const docs = await this.assignments
			.find(filter)
			.sort({ createdAt: 1, _id: 1 })
			.limit(query.limit + 1)
			.lean<AdvisorClientAssignmentDoc[]>()
			.exec();
		const page = docs.slice(0, query.limit);
		const last = page[page.length - 1];
		return {
			ids: page.map((d) => d.clientProfileId),
			nextCursor:
				docs.length > query.limit && last
					? encodeRelationshipCursor({
							createdAt: last.createdAt,
							id: last._id,
						})
					: null,
		};
	}

	async deleteByUser(orgId: string, userId: string): Promise<number> {
		const result = await this.assignments.deleteMany({ orgId, userId }).exec();
		return result.deletedCount ?? 0;
	}

	async deleteAllForUser(userId: string): Promise<number> {
		const result = await this.assignments.deleteMany({ userId }).exec();
		return result.deletedCount ?? 0;
	}

	async deleteByClient(
		orgId: string,
		clientProfileId: string
	): Promise<number> {
		const result = await this.assignments
			.deleteMany({ orgId, clientProfileId })
			.exec();
		return result.deletedCount ?? 0;
	}
}
