import { ForbiddenException } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { AssetClass, OrgRole, ProfileOrigin } from '../domain/enums';
import {
	AllocationTargetService,
	InvalidAllocationTargetError,
} from './allocation-target.service';
import { AuthorizationService } from './authorization.service';
import {
	InMemoryAllocationTargetStore,
	InMemoryClientProfileStore,
	InMemoryMembershipStore,
	InMemoryRelationshipStore,
} from './in-memory-stores.fixture';
import { RelationshipService } from './relationship.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];

	async record(event: AuditEventInput): Promise<void> {
		this.recorded.push(event);
	}
}

describe('AllocationTargetService', () => {
	const ctx = { userId: 'user-1', orgId: 'orgA' };
	let store: InMemoryAllocationTargetStore;
	let service: AllocationTargetService;

	beforeEach(async () => {
		const memberships = new InMemoryMembershipStore();
		const profiles = new InMemoryClientProfileStore();
		const relationships = new InMemoryRelationshipStore();
		const rel = new RelationshipService(relationships);
		store = new InMemoryAllocationTargetStore();
		const authz = new AuthorizationService(
			memberships,
			relationships,
			profiles,
			new FakeAuditTrail()
		);
		service = new AllocationTargetService(authz, store);
		await memberships.create({
			userId: 'user-1',
			orgId: 'orgA',
			role: OrgRole.Advisor,
		});
		profiles.seed({
			id: 'clientA',
			orgId: 'orgA',
			name: 'clientA',
			origin: ProfileOrigin.AdvisorCreated,
		});
		profiles.seed({
			id: 'clientB',
			orgId: 'orgB',
			name: 'clientB',
			origin: ProfileOrigin.AdvisorCreated,
		});
		await rel.create('orgA', 'clientA');
		await rel.create('orgB', 'clientB');
	});

	it('stores a valid target with identity from ctx', async () => {
		const saved = await service.setTarget(ctx, 'clientA', {
			[AssetClass.Stock]: 60,
			[AssetClass.Fii]: 40,
		});
		expect(saved.orgId).toBe('orgA');
		expect(saved.updatedByUserId).toBe('user-1');
		expect((await service.getTarget(ctx, 'clientA'))?.targets).toEqual(
			expect.objectContaining({ STOCK: 60 })
		);
	});

	it.each([99, 101])('rejects a sum of %s', async (stock) => {
		await expect(
			service.setTarget(ctx, 'clientA', { [AssetClass.Stock]: stock })
		).rejects.toBeInstanceOf(InvalidAllocationTargetError);
	});

	it('rejects keys outside the enum', async () => {
		await expect(
			service.setTarget(ctx, 'clientA', { BOND: 100 } as never)
		).rejects.toBeInstanceOf(InvalidAllocationTargetError);
	});

	it('rejects negative and non-finite values and an empty target', async () => {
		await expect(
			service.setTarget(ctx, 'clientA', {
				[AssetClass.Stock]: 120,
				[AssetClass.Fii]: -20,
			})
		).rejects.toBeInstanceOf(InvalidAllocationTargetError);
		await expect(
			service.setTarget(ctx, 'clientA', { [AssetClass.Stock]: NaN })
		).rejects.toBeInstanceOf(InvalidAllocationTargetError);
		await expect(service.setTarget(ctx, 'clientA', {})).rejects.toBeInstanceOf(
			InvalidAllocationTargetError
		);
	});

	it('accepts 33.33 + 33.33 + 33.34', async () => {
		await expect(
			service.setTarget(ctx, 'clientA', {
				[AssetClass.Stock]: 33.33,
				[AssetClass.Fii]: 33.33,
				[AssetClass.Etf]: 33.34,
			})
		).resolves.toBeDefined();
	});

	it('last write wins', async () => {
		await service.setTarget(ctx, 'clientA', { [AssetClass.Stock]: 100 });
		await service.setTarget(ctx, 'clientA', { [AssetClass.Fii]: 100 });
		expect((await service.getTarget(ctx, 'clientA'))?.targets).toEqual({
			FII: 100,
		});
	});

	it('other org is forbidden and nothing is stored', async () => {
		await expect(
			service.setTarget(ctx, 'clientB', { [AssetClass.Stock]: 100 })
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(await store.find('orgB', 'clientB')).toBeNull();
		await expect(service.getTarget(ctx, 'clientB')).rejects.toBeInstanceOf(
			ForbiddenException
		);
	});

	it('getTarget without a target returns null', async () => {
		expect(await service.getTarget(ctx, 'clientA')).toBeNull();
	});
});
