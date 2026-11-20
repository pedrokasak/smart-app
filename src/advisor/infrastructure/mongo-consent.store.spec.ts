import { ConflictException } from '@nestjs/common';
import { Model } from 'mongoose';
import { ConsentStatus } from '../domain/enums';
import {
	AdvisorConsentDoc,
	CONSENT_USER_ORG_ACTIVE_INDEX,
} from './advisor-consent.models';
import { MongoConsentStore } from './mongo-consent.store';

/**
 * Cobre só a lógica de `grant` em volta dos erros de chave duplicada, com um
 * model falso. A unicidade em si (índices) só o Mongo real prova: ver
 * `mongo-stores.contract.spec.ts`.
 */
const grantedAt = new Date('2030-01-01T00:00:00Z');
const input = {
	orgId: 'org-1',
	clientProfileId: 'profile-1',
	relationshipId: 'rel-1',
	userId: 'user-1',
	portfolioIds: ['p1'],
	textVersion: 'v1',
	grantedAt,
};

const query = <T>(result: T) => {
	const q: Record<string, unknown> = {};
	for (const method of ['sort', 'select', 'lean']) q[method] = () => q;
	q.exec = () => Promise.resolve(result);
	return q;
};

const duplicate = (keyPattern: Record<string, number>) =>
	Object.assign(new Error('E11000 duplicate key'), {
		code: 11000,
		keyPattern,
	});

function build() {
	const model = {
		findOne: jest.fn(),
		updateMany: jest.fn().mockReturnValue(query({})),
		create: jest.fn(),
	};
	const store = new MongoConsentStore(
		model as unknown as Model<AdvisorConsentDoc>
	);
	return { store, model };
}

const created = (version: number) => ({
	toObject: () => ({
		_id: `c${version}`,
		...input,
		version,
		status: ConsentStatus.Active,
		createdAt: grantedAt,
		updatedAt: grantedAt,
	}),
});

describe('MongoConsentStore.grant', () => {
	it('supersedes the ACTIVE consent, then inserts max(version) + 1', async () => {
		const { store, model } = build();
		model.findOne.mockReturnValue(query({ version: 2 }));
		model.create.mockResolvedValue(created(3));

		const result = await store.grant(input);

		expect(result.version).toBe(3);
		expect(model.updateMany).toHaveBeenCalledWith(
			{ relationshipId: 'rel-1', status: ConsentStatus.Active },
			{
				$set: { status: ConsentStatus.Superseded, endedAt: grantedAt },
			}
		);
		expect(model.create).toHaveBeenCalledWith(
			expect.objectContaining({ version: 3, status: ConsentStatus.Active })
		);
	});

	it('starts at version 1 for a relationship without consents', async () => {
		const { store, model } = build();
		model.findOne.mockReturnValue(query(null));
		model.create.mockResolvedValue(created(1));

		await store.grant(input);

		expect(model.create).toHaveBeenCalledWith(
			expect.objectContaining({ version: 1 })
		);
	});

	it('retries with a fresh version when a concurrent grant of the same relationship wins', async () => {
		const { store, model } = build();
		model.findOne
			.mockReturnValueOnce(query(null))
			.mockReturnValueOnce(query({ version: 1 }));
		model.create
			.mockRejectedValueOnce(duplicate({ relationshipId: 1, version: 1 }))
			.mockResolvedValueOnce(created(2));

		const result = await store.grant(input);

		expect(result.version).toBe(2);
		expect(model.create).toHaveBeenCalledTimes(2);
	});

	it('treats a user + org duplicate of the SAME relationship as that race', async () => {
		const { store, model } = build();
		model.findOne
			.mockReturnValueOnce(query(null))
			.mockReturnValueOnce(query({ relationshipId: 'rel-1' }))
			.mockReturnValueOnce(query({ version: 1 }));
		model.create
			.mockRejectedValueOnce(duplicate({ userId: 1, orgId: 1 }))
			.mockResolvedValueOnce(created(2));

		const result = await store.grant(input);

		expect(result.version).toBe(2);
	});

	it('refuses with a conflict when the user is already linked to the org through another relationship', async () => {
		const { store, model } = build();
		model.findOne
			.mockReturnValueOnce(query(null))
			.mockReturnValueOnce(query({ relationshipId: 'rel-OTHER' }));
		model.create.mockRejectedValueOnce(duplicate({ userId: 1, orgId: 1 }));

		await expect(store.grant(input)).rejects.toBeInstanceOf(ConflictException);
		expect(model.create).toHaveBeenCalledTimes(1);
	});

	it('recognises the user + org index by its name when keyPattern is missing', async () => {
		const { store, model } = build();
		model.findOne
			.mockReturnValueOnce(query(null))
			.mockReturnValueOnce(query({ relationshipId: 'rel-OTHER' }));
		model.create.mockRejectedValueOnce(
			Object.assign(
				new Error(`E11000 index: ${CONSENT_USER_ORG_ACTIVE_INDEX} dup key`),
				{ code: 11000 }
			)
		);

		await expect(store.grant(input)).rejects.toBeInstanceOf(ConflictException);
	});

	it('gives up with a retryable conflict (never the raw E11000) after the bounded attempts', async () => {
		const { store, model } = build();
		model.findOne.mockReturnValue(query({ version: 1 }));
		model.create.mockRejectedValue(
			duplicate({ relationshipId: 1, version: 1 })
		);

		const error = await store.grant(input).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ConflictException);
		expect((error as ConflictException).message).toBe(
			'Consent is being changed concurrently, try again'
		);
		expect(model.create).toHaveBeenCalledTimes(5);
	});

	it('does not retry an unrelated failure', async () => {
		const { store, model } = build();
		model.findOne.mockReturnValue(query(null));
		const error = new Error('connection lost');
		model.create.mockRejectedValue(error);

		await expect(store.grant(input)).rejects.toBe(error);
		expect(model.create).toHaveBeenCalledTimes(1);
	});
});
