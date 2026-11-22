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

	it('revoke sets status to REVOKED and reports the change', async () => {
		const r = await svc.create('orgA', 'cp1');
		await expect(svc.revoke(r.id)).resolves.toBe(true);
		expect((await store.findById(r.id))?.status).toBe(
			RelationshipStatus.Revoked
		);
	});

	it('revoke is a no-op when already revoked', async () => {
		const r = await svc.create('orgA', 'cp1');
		await svc.revoke(r.id);
		const saveSpy = jest.spyOn(store, 'save');
		await expect(svc.revoke(r.id)).resolves.toBe(false);
		expect(saveSpy).not.toHaveBeenCalled();
		expect((await store.findById(r.id))?.status).toBe(
			RelationshipStatus.Revoked
		);
	});

	it('revoke throws NotFoundException for unknown id', async () => {
		await expect(svc.revoke('missing')).rejects.toThrow(NotFoundException);
	});

	it('deleteCreated apaga só a relação daquele id', async () => {
		const a = await svc.createPending('orgA', 'p1');
		const b = await svc.createPending('orgA', 'p2');
		await svc.deleteCreated(a.id);
		expect(await store.findById(a.id)).toBeNull();
		expect(await store.findById(b.id)).not.toBeNull();
	});

	describe('createPending', () => {
		it('always creates a new PENDING relationship', async () => {
			const first = await svc.createPending('orgA', 'cp1');
			const second = await svc.createPending('orgA', 'cp1');
			expect(first.status).toBe(RelationshipStatus.Pending);
			expect(second.status).toBe(RelationshipStatus.Pending);
			expect(second.id).not.toBe(first.id);
			expect(store.size).toBe(2);
		});

		it('does not return an ACTIVE relationship', async () => {
			const active = await svc.create('orgA', 'cp1');
			const pending = await svc.createPending('orgA', 'cp1');
			expect(pending.id).not.toBe(active.id);
			expect(pending.status).toBe(RelationshipStatus.Pending);
		});
	});

	describe('revokePending', () => {
		it('revokes a PENDING relationship', async () => {
			const pending = await svc.createPending('orgA', 'cp1');
			await svc.revokePending(pending.id);
			expect((await store.findById(pending.id))?.status).toBe(
				RelationshipStatus.Revoked
			);
		});

		it('leaves an ACTIVE relationship untouched', async () => {
			const active = await svc.create('orgA', 'cp1');
			await svc.revokePending(active.id);
			expect((await store.findById(active.id))?.status).toBe(
				RelationshipStatus.Active
			);
		});

		it('leaves a REVOKED relationship untouched and ignores unknown ids', async () => {
			const rel = await svc.create('orgA', 'cp1');
			await svc.revoke(rel.id);
			await svc.revokePending(rel.id);
			await expect(svc.revokePending('missing')).resolves.toBeUndefined();
			expect((await store.findById(rel.id))?.status).toBe(
				RelationshipStatus.Revoked
			);
		});
	});
});
