import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProfileOrigin } from '../domain/enums';
import { ClientProfileService } from './client-profile.service';
import { InMemoryClientProfileStore } from './in-memory-stores.fixture';

describe('ClientProfileService', () => {
	let store: InMemoryClientProfileStore;
	let svc: ClientProfileService;

	beforeEach(() => {
		store = new InMemoryClientProfileStore();
		svc = new ClientProfileService(store);
	});

	it('createByAdvisor persists name, ADVISOR_CREATED origin and no owner', async () => {
		const p = await svc.createByAdvisor('orgA', { name: 'João' });
		expect(p.name).toBe('João');
		expect(p.orgId).toBe('orgA');
		expect(p.origin).toBe(ProfileOrigin.AdvisorCreated);
		expect(p.ownerUserId).toBeUndefined();
		expect(await store.findById(p.id)).toEqual(p);
	});

	it('claim converts an ADVISOR_CREATED profile to CLIENT_CREATED with owner', async () => {
		const p = await svc.createByAdvisor('orgA', { name: 'João' });
		const claimed = await svc.claim(p.id, 'u9');
		expect(claimed.origin).toBe(ProfileOrigin.ClientCreated);
		expect(claimed.ownerUserId).toBe('u9');
		expect((await store.findById(p.id))?.ownerUserId).toBe('u9');
	});

	it('claim of an already CLIENT_CREATED profile throws and keeps the owner', async () => {
		const p = await svc.createByAdvisor('orgA', { name: 'João' });
		const claimed = await svc.claim(p.id, 'u9');
		await expect(svc.claim(claimed.id, 'uOutro')).rejects.toThrow(
			ConflictException
		);
		expect((await store.findById(p.id))?.ownerUserId).toBe('u9');
	});

	it('claim of an ADVISOR_CREATED profile that already has an owner throws and keeps the owner', async () => {
		const p = await store.create({
			orgId: 'orgA',
			name: 'João',
			origin: ProfileOrigin.AdvisorCreated,
			ownerUserId: 'u1',
		});
		await expect(svc.claim(p.id, 'u2')).rejects.toThrow(ConflictException);
		const stored = await store.findById(p.id);
		expect(stored?.ownerUserId).toBe('u1');
		expect(stored?.origin).toBe(ProfileOrigin.AdvisorCreated);
	});

	it('claim throws NotFoundException for unknown id', async () => {
		await expect(svc.claim('missing', 'u1')).rejects.toThrow(NotFoundException);
	});
});
