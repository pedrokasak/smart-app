import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RelationshipStorePort } from '../application/ports/relationship.store.port';
import { AdvisoryRelationship } from '../domain/entities';
import { RelationshipStatus } from '../domain/enums';
import { toRelationship } from './advisor.mappers';
import {
	ADVISOR_RELATIONSHIP_MODEL,
	AdvisorRelationshipDoc,
} from './advisor.models';

const DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
	return (error as { code?: number } | null)?.code === DUPLICATE_KEY;
}

@Injectable()
export class MongoRelationshipStore implements RelationshipStorePort {
	constructor(
		@InjectModel(ADVISOR_RELATIONSHIP_MODEL)
		private readonly relationships: Model<AdvisorRelationshipDoc>
	) {}

	/**
	 * Se já existe uma relação ACTIVE para (orgId, clientProfileId), o índice
	 * parcial recusa a segunda e devolvemos a existente (criação idempotente).
	 */
	async create(
		relationship: Omit<AdvisoryRelationship, 'id'>
	): Promise<AdvisoryRelationship> {
		try {
			const created = await this.relationships.create(relationship);
			return toRelationship(created.toObject());
		} catch (error) {
			if (!isDuplicateKey(error)) {
				throw error;
			}
			const existing = await this.findActive(
				relationship.orgId,
				relationship.clientProfileId
			);
			if (!existing) {
				throw error;
			}
			return existing;
		}
	}

	async findById(id: string): Promise<AdvisoryRelationship | null> {
		const doc = await this.relationships
			.findById(id)
			.lean<AdvisorRelationshipDoc>()
			.exec();
		return doc ? toRelationship(doc) : null;
	}

	async findByOrgAndClient(
		orgId: string,
		clientProfileId: string
	): Promise<AdvisoryRelationship | null> {
		const active = await this.findActive(orgId, clientProfileId);
		if (active) {
			return active;
		}
		const latest = await this.relationships
			.findOne({ orgId, clientProfileId })
			.sort({ createdAt: -1, _id: -1 })
			.lean<AdvisorRelationshipDoc>()
			.exec();
		return latest ? toRelationship(latest) : null;
	}

	async save(
		relationship: AdvisoryRelationship
	): Promise<AdvisoryRelationship> {
		const { id, consentId, scope, ...fields } = relationship;
		const set: Record<string, unknown> = { ...fields };
		const unset: Record<string, ''> = {};
		if (consentId === undefined) {
			unset.consentId = '';
		} else {
			set.consentId = consentId;
		}
		if (scope === undefined) {
			unset.scope = '';
		} else {
			set.scope = scope;
		}
		const doc = await this.relationships
			.findOneAndUpdate(
				{ _id: id },
				{ $set: set, $unset: unset },
				{ new: true, upsert: true, setDefaultsOnInsert: true }
			)
			.lean<AdvisorRelationshipDoc>()
			.exec();
		return toRelationship(doc);
	}

	async activate(
		id: string,
		consentId: string
	): Promise<AdvisoryRelationship | null> {
		const doc = await this.relationships
			.findOneAndUpdate(
				{ _id: id, status: RelationshipStatus.Pending },
				{ $set: { status: RelationshipStatus.Active, consentId } },
				{ new: true }
			)
			.lean<AdvisorRelationshipDoc>()
			.exec();
		return doc ? toRelationship(doc) : null;
	}

	async setConsentIfActive(
		id: string,
		consentId: string
	): Promise<AdvisoryRelationship | null> {
		const doc = await this.relationships
			.findOneAndUpdate(
				{ _id: id, status: RelationshipStatus.Active },
				{ $set: { consentId } },
				{ new: true }
			)
			.lean<AdvisorRelationshipDoc>()
			.exec();
		return doc ? toRelationship(doc) : null;
	}

	async listActiveByClientProfiles(
		clientProfileIds: string[]
	): Promise<AdvisoryRelationship[]> {
		if (clientProfileIds.length === 0) return [];
		const docs = await this.relationships
			.find({
				clientProfileId: { $in: clientProfileIds },
				status: RelationshipStatus.Active,
			})
			.lean<AdvisorRelationshipDoc[]>()
			.exec();
		return docs.map(toRelationship);
	}

	private async findActive(
		orgId: string,
		clientProfileId: string
	): Promise<AdvisoryRelationship | null> {
		const doc = await this.relationships
			.findOne({ orgId, clientProfileId, status: RelationshipStatus.Active })
			.lean<AdvisorRelationshipDoc>()
			.exec();
		return doc ? toRelationship(doc) : null;
	}
}
