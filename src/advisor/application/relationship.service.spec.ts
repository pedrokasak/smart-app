import { NotFoundException } from '@nestjs/common';
import { RelationshipStatus } from '../domain/enums';
import { InMemoryRelationshipStore } from './in-memory-stores.fixture';
import { RelationshipService } from './relationship.service';

describe('RelationshipService', () => {
	let store: InMemoryRelationshipStore;
	let svc: RelationshipService;

	beforeEach(() => {
		store = new InMemoryRelationshipStore();
		svc = new RelationshipService(store);
	});

	it('creates an ACTIVE relationship', async () => {
		const r = await svc.create('orgA', 'cp1');
		expect(r).toMatchObject({
			orgId: 'orgA',
			clientProfileId: 'cp1',
			status: RelationshipStatus.Active,
		});
		expect(r.id).toBeDefined();
	});

	it('returns the existing ACTIVE relationship without creating another', async () => {
		const first = await svc.create('orgA', 'cp1');
		const second = await svc.create('orgA', 'cp1');
		expect(second.id).toBe(first.id);
		const all = [await store.findByOrgAndClient('orgA', 'cp1')];
		expect(all[0]?.id).toBe(first.id);
	});

	it('creates a new ACTIVE row when only a REVOKED one exists', async () => {
		const first = await svc.create('orgA', 'cp1');
		await svc.revoke(first.id);
		const second = await svc.create('orgA', 'cp1');
		expect(second.id).not.toBe(first.id);
		expect(second.status).toBe(RelationshipStatus.Active);
		expect((await store.findById(first.id))?.status).toBe(
			RelationshipStatus.Revoked
		);
		expect((await store.findByOrgAndClient('orgA', 'cp1'))?.id).toBe(second.id);
	});

	it('revoke sets status to REVOKED', async () => {
		const r = await svc.create('orgA', 'cp1');
		await svc.revoke(r.id);
		expect((await store.findById(r.id))?.status).toBe(
			RelationshipStatus.Revoked
		);
	});

	it('revoke is a no-op when already revoked', async () => {
		const r = await svc.create('orgA', 'cp1');
		await svc.revoke(r.id);
		const saveSpy = jest.spyOn(store, 'save');
		await expect(svc.revoke(r.id)).resolves.toBeUndefined();
		expect(saveSpy).not.toHaveBeenCalled();
		expect((await store.findById(r.id))?.status).toBe(
			RelationshipStatus.Revoked
		);
	});

	it('revoke throws NotFoundException for unknown id', async () => {
		await expect(svc.revoke('missing')).rejects.toThrow(NotFoundException);
	});
});
