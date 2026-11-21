import { Logger, NotFoundException } from '@nestjs/common';
import type { SecurityEventInput } from 'src/audit/application/security-audit.service';
import { SECURITY_EVENT } from 'src/audit/domain/security-events';
import {
	ALL_PLAN_CAPABILITIES,
	FREE_ACCESS_LEVEL,
	PlanAccess,
	PREMIUM_ACCESS_LEVEL,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';
import {
	InMemoryPortalAccountDirectory,
	InMemoryPortalGrantStore,
} from './in-memory-stores.fixture';
import { PortalAccessService } from './portal-access.service';

const USER = '64b000000000000000000001';
const ADMIN = '64b0000000000000000000ad';

class FakePlans implements UserPlanResolverPort {
	access: PlanAccess = { tier: FREE_ACCESS_LEVEL, capabilities: [] };
	failWith?: Error;

	async resolve(): Promise<number> {
		return this.access.tier;
	}

	async resolveWithCapabilities(): Promise<PlanAccess> {
		if (this.failWith) throw this.failWith;
		return this.access;
	}
}

describe('PortalAccessService', () => {
	let grants: InMemoryPortalGrantStore;
	let accounts: InMemoryPortalAccountDirectory;
	let plans: FakePlans;
	let events: SecurityEventInput[];
	let service: PortalAccessService;

	beforeEach(() => {
		grants = new InMemoryPortalGrantStore();
		accounts = new InMemoryPortalAccountDirectory();
		accounts.set(USER, 'investidor@example.com');
		plans = new FakePlans();
		events = [];
		service = new PortalAccessService(grants, accounts, plans, {
			emit: (event) => events.push(event),
		});
	});

	describe('hasAccess', () => {
		it('is true when the plan has advisor.portal', async () => {
			plans.access = {
				tier: FREE_ACCESS_LEVEL,
				capabilities: ['advisor.portal'],
				capabilitiesKnown: [...ALL_PLAN_CAPABILITIES],
			};
			await expect(service.hasAccess(USER)).resolves.toBe(true);
		});

		it('is true with an active grant and no plan', async () => {
			await grants.grant(USER, ADMIN, new Date());
			await expect(service.hasAccess(USER)).resolves.toBe(true);
		});

		it('is false once the grant is revoked', async () => {
			await grants.grant(USER, ADMIN, new Date());
			await grants.revoke(USER, new Date());
			await expect(service.hasAccess(USER)).resolves.toBe(false);
		});

		it('is false for a Wealth plan (tier 20) never configured with capabilities', async () => {
			plans.access = { tier: PREMIUM_ACCESS_LEVEL, capabilities: [] };
			await expect(service.hasAccess(USER)).resolves.toBe(false);
		});

		it('is false for a plan configured before advisor.portal existed', async () => {
			plans.access = {
				tier: PREMIUM_ACCESS_LEVEL,
				capabilities: ['ai.insights', 'fiscal.darf'],
				capabilitiesKnown: ALL_PLAN_CAPABILITIES.filter(
					(c) => c !== 'advisor.portal'
				),
			};
			await expect(service.hasAccess(USER)).resolves.toBe(false);
		});

		it('is false when reading the plan fails, never access', async () => {
			plans.failWith = new Error('subscription lookup down');
			await expect(service.hasAccess(USER)).resolves.toBe(false);
		});

		it('logs only the error class when reading the plan fails', async () => {
			const warn = jest
				.spyOn(Logger.prototype, 'warn')
				.mockImplementation(() => undefined);
			class PlanLookupError extends Error {}
			plans.failWith = new PlanLookupError('lookup failed for x@example.com');
			try {
				await service.hasAccess(USER);
				const logged = warn.mock.calls.flat().join(' ');
				expect(logged).toContain('PlanLookupError');
				expect(logged).not.toContain('x@example.com');
			} finally {
				warn.mockRestore();
			}
		});

		it('still honours an active grant when reading the plan fails', async () => {
			plans.failWith = new Error('subscription lookup down');
			await grants.grant(USER, ADMIN, new Date());
			await expect(service.hasAccess(USER)).resolves.toBe(true);
		});
	});

	describe('grantByEmail', () => {
		it('grants by e-mail (trimmed, any case) and audits ids only', async () => {
			await expect(
				service.grantByEmail(ADMIN, '  Investidor@Example.com ')
			).resolves.toEqual({ userId: USER });

			const active = await grants.findActive(USER);
			expect(active).toMatchObject({ userId: USER, grantedBy: ADMIN });
			expect(events).toEqual([
				{
					type: SECURITY_EVENT.AdvisorPortalGranted,
					actor: { userId: ADMIN },
					subject: { userId: USER },
					payload: { grantId: active!.id },
				},
			]);
			expect(JSON.stringify(events)).not.toContain('example.com');
		});

		it('granting twice keeps a single active grant', async () => {
			await service.grantByEmail(ADMIN, 'investidor@example.com');
			await service.grantByEmail(ADMIN, 'investidor@example.com');
			expect(await grants.listActive()).toHaveLength(1);
		});

		it('an e-mail without an account is a NotFoundException', async () => {
			await expect(
				service.grantByEmail(ADMIN, 'ninguem@example.com')
			).rejects.toBeInstanceOf(NotFoundException);
			expect(await grants.listActive()).toEqual([]);
			expect(events).toEqual([]);
		});
	});

	describe('revoke', () => {
		it('revokes the active grant and audits ids only', async () => {
			await service.grantByEmail(ADMIN, 'investidor@example.com');
			events.length = 0;

			await service.revoke(ADMIN, USER);

			await expect(service.hasAccess(USER)).resolves.toBe(false);
			expect(events).toEqual([
				{
					type: SECURITY_EVENT.AdvisorPortalRevoked,
					actor: { userId: ADMIN },
					subject: { userId: USER },
				},
			]);
		});

		it('without an active grant is a NotFoundException and audits nothing', async () => {
			await expect(service.revoke(ADMIN, USER)).rejects.toBeInstanceOf(
				NotFoundException
			);
			expect(events).toEqual([]);
		});
	});

	describe('listGrants', () => {
		it('lists active grants with the e-mail masked', async () => {
			const at = new Date('2026-11-20T12:00:00Z');
			await grants.grant(USER, ADMIN, at);

			const list = await service.listGrants();

			expect(list).toEqual([
				{ userId: USER, emailMasked: 'in***@ex***.com', grantedAt: at },
			]);
			expect(JSON.stringify(list)).not.toContain('investidor@');
		});

		it('an account deleted since the grant shows no e-mail', async () => {
			const other = '64b000000000000000000002';
			await grants.grant(other, ADMIN, new Date());
			const list = await service.listGrants();
			expect(list).toEqual([
				expect.objectContaining({ userId: other, emailMasked: null }),
			]);
		});
	});
});
