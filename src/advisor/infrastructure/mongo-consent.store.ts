import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConsentStorePort } from '../application/ports/consent.store.port';
import { Consent } from '../domain/consent.entities';
import { ConsentStatus } from '../domain/enums';
import {
	ADVISOR_CONSENT_MODEL,
	AdvisorConsentDoc,
	CONSENT_USER_ORG_ACTIVE_INDEX,
} from './advisor-consent.models';
import { toConsent } from './advisor.mappers';

const DUPLICATE_KEY = 11000;

/**
 * Cada tentativa perdida significa que um grant concorrente da mesma relação
 * venceu a corrida; com N concorrentes, N - 1 tentativas bastam no pior caso.
 */
const MAX_GRANT_ATTEMPTS = 5;

interface DuplicateKeyError {
	code?: number;
	keyPattern?: Record<string, unknown>;
	message?: string;
}

function isDuplicateKey(error: unknown): error is DuplicateKeyError {
	return (error as DuplicateKeyError | null)?.code === DUPLICATE_KEY;
}

/** O índice parcial `{ userId, orgId }` foi o que recusou a inserção? */
function isUserOrgDuplicate(error: DuplicateKeyError): boolean {
	return (
		(error.keyPattern?.userId !== undefined &&
			error.keyPattern?.orgId !== undefined) ||
		String(error.message ?? '').includes(CONSENT_USER_ORG_ACTIVE_INDEX)
	);
}

@Injectable()
export class MongoConsentStore implements ConsentStorePort {
	constructor(
		@InjectModel(ADVISOR_CONSENT_MODEL)
		private readonly consents: Model<AdvisorConsentDoc>
	) {}

	/**
	 * Sem transação: marca o ACTIVE atual como SUPERSEDED e insere o novo.
	 * Um grant concorrente da mesma relação bate no índice único parcial
	 * `{ relationshipId }` ou em `{ relationshipId, version }`: relê a versão
	 * e tenta de novo, até `MAX_GRANT_ATTEMPTS`. Quem bate no índice
	 * `{ userId, orgId }` por causa de OUTRA relação da mesma organização
	 * recebe o mesmo conflito que o ConsentService já usa; se a duplicata é
	 * da própria relação, é só a corrida acima.
	 */
	async grant(
		consent: Omit<Consent, 'id' | 'version' | 'status' | 'endedAt'>
	): Promise<Consent> {
		let lastError: unknown;
		for (let attempt = 1; attempt <= MAX_GRANT_ATTEMPTS; attempt += 1) {
			const version = await this.nextVersion(consent.relationshipId);
			await this.consents
				.updateMany(
					{
						relationshipId: consent.relationshipId,
						status: ConsentStatus.Active,
					},
					{
						$set: {
							status: ConsentStatus.Superseded,
							endedAt: consent.grantedAt,
						},
					}
				)
				.exec();
			try {
				const created = await this.consents.create({
					...consent,
					version,
					status: ConsentStatus.Active,
				});
				return toConsent(created.toObject());
			} catch (error) {
				if (!isDuplicateKey(error)) throw error;
				if (
					isUserOrgDuplicate(error) &&
					(await this.linkedThroughAnotherRelationship(consent))
				) {
					throw new ConflictException('Already linked to this organization');
				}
				lastError = error;
			}
		}
		throw lastError;
	}

	async listByRelationship(relationshipId: string): Promise<Consent[]> {
		const docs = await this.consents
			.find({ relationshipId })
			.sort({ version: 1 })
			.lean<AdvisorConsentDoc[]>()
			.exec();
		return docs.map(toConsent);
	}

	async findActiveByRelationship(
		relationshipId: string
	): Promise<Consent | null> {
		const doc = await this.consents
			.findOne({ relationshipId, status: ConsentStatus.Active })
			.lean<AdvisorConsentDoc>()
			.exec();
		return doc ? toConsent(doc) : null;
	}

	async listActiveByUser(userId: string): Promise<Consent[]> {
		const docs = await this.consents
			.find({ userId, status: ConsentStatus.Active })
			.sort({ grantedAt: 1, _id: 1 })
			.lean<AdvisorConsentDoc[]>()
			.exec();
		return docs.map(toConsent);
	}

	async listByUser(userId: string): Promise<Consent[]> {
		const docs = await this.consents
			.find({ userId })
			.sort({ grantedAt: 1, version: 1, _id: 1 })
			.lean<AdvisorConsentDoc[]>()
			.exec();
		return docs.map(toConsent);
	}

	/** Um único `findOneAndUpdate` com ACTIVE e o titular no filtro. */
	async revokeActive(
		relationshipId: string,
		userId: string,
		at: Date
	): Promise<Consent | null> {
		const doc = await this.consents
			.findOneAndUpdate(
				{ relationshipId, userId, status: ConsentStatus.Active },
				{ $set: { status: ConsentStatus.Revoked, endedAt: at } },
				{ new: true }
			)
			.lean<AdvisorConsentDoc>()
			.exec();
		return doc ? toConsent(doc) : null;
	}

	async deleteByUser(userId: string): Promise<number> {
		const result = await this.consents.deleteMany({ userId }).exec();
		return result.deletedCount ?? 0;
	}

	private async nextVersion(relationshipId: string): Promise<number> {
		const latest = await this.consents
			.findOne({ relationshipId })
			.sort({ version: -1 })
			.select({ version: 1 })
			.lean<Pick<AdvisorConsentDoc, 'version'>>()
			.exec();
		return (latest?.version ?? 0) + 1;
	}

	private async linkedThroughAnotherRelationship(
		consent: Pick<Consent, 'userId' | 'orgId' | 'relationshipId'>
	): Promise<boolean> {
		const active = await this.consents
			.findOne({
				userId: consent.userId,
				orgId: consent.orgId,
				status: ConsentStatus.Active,
			})
			.select({ relationshipId: 1 })
			.lean<Pick<AdvisorConsentDoc, 'relationshipId'>>()
			.exec();
		return !!active && active.relationshipId !== consent.relationshipId;
	}
}
