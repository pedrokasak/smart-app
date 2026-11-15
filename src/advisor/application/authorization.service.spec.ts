import { ForbiddenException } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import { OrgRole } from '../domain/enums';
import { AuthorizationService } from './authorization.service';
import {
	InMemoryMembershipStore,
	InMemoryRelationshipStore,
} from './in-memory-stores.fixture';
import { RelationshipService } from './relationship.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];
	failWith?: Error;

	async record(event: AuditEventInput): Promise<void> {
		if (this.failWith) throw this.failWith;
		this.recorded.push(event);
	}
}

describe('AuthorizationService', () => {
	const userId = 'user-raw-id-123';
	let memberships: InMemoryMembershipStore;
	let relationships: InMemoryRelationshipStore;
	let rel: RelationshipService;
	let audit: FakeAuditTrail;
	let authz: AuthorizationService;

	beforeEach(async () => {
		memberships = new InMemoryMembershipStore();
		relationships = new InMemoryRelationshipStore();
		rel = new RelationshipService(relationships);
		audit = new FakeAuditTrail();
		authz = new AuthorizationService(memberships, relationships, audit);
		await memberships.create({ userId, orgId: 'orgA', role: OrgRole.Advisor });
	});

	it('denies a client of another org and audits nothing', async () => {
		await rel.create('orgB', 'clientB');
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgA' },
				'clientB',
				'VIEW_PORTFOLIO'
			)
		).rejects.toThrow(ForbiddenException);
		expect(audit.recorded).toHaveLength(0);
	});

	it('allows a valid access and records one pseudonymous event', async () => {
		await rel.create('orgA', 'clientA');
		await authz.ensureCanAccessClient(
			{ userId, orgId: 'orgA' },
			'clientA',
			'VIEW_PORTFOLIO'
		);
		expect(audit.recorded).toHaveLength(1);
		const event = audit.recorded[0];
		expect(event).toMatchObject({
			type: 'advisor.client.accessed',
			version: 1,
			subject: 'clientA',
			actorRef: actorRefOf(userId),
		});
		expect(Object.keys(event).sort()).toEqual(
			[
				'eventId',
				'type',
				'version',
				'subject',
				'actorRef',
				'occurredAt',
				'payload',
			].sort()
		);
		expect(event.payload).toEqual({ action: 'VIEW_PORTFOLIO', orgId: 'orgA' });
		expect(event.eventId).toEqual(expect.any(String));
		expect(event.occurredAt).toBeInstanceOf(Date);
		expect(JSON.stringify(event)).not.toContain(userId);
	});

	it('denies after the relationship is revoked and audits nothing', async () => {
		const r = await rel.create('orgA', 'clientA');
		await rel.revoke(r.id);
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgA' },
				'clientA',
				'VIEW_PORTFOLIO'
			)
		).rejects.toThrow(ForbiddenException);
		expect(audit.recorded).toHaveLength(0);
	});

	it('denies a user without membership in the org', async () => {
		await rel.create('orgA', 'clientA');
		await expect(
			authz.ensureCanAccessClient(
				{ userId: 'stranger', orgId: 'orgA' },
				'clientA',
				'VIEW_PORTFOLIO'
			)
		).rejects.toThrow(ForbiddenException);
		expect(audit.recorded).toHaveLength(0);
	});

	it('denies when there is no relationship with the client', async () => {
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgA' },
				'unknown-client',
				'VIEW_PORTFOLIO'
			)
		).rejects.toThrow(ForbiddenException);
		expect(audit.recorded).toHaveLength(0);
	});

	it('never falls back to another org membership', async () => {
		// user is a member of orgA only; orgB has an ACTIVE relationship
		await rel.create('orgB', 'clientB');
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgB' },
				'clientB',
				'VIEW_PORTFOLIO'
			)
		).rejects.toThrow(ForbiddenException);
		expect(audit.recorded).toHaveLength(0);
	});

	it('denies ctx.orgId of an org the user is not in, even if the client is active in the user org', async () => {
		// member of orgA only, ACTIVE orgA<->clientA; a fallback would allow this
		await rel.create('orgA', 'clientA');
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgB' },
				'clientA',
				'VIEW_PORTFOLIO'
			)
		).rejects.toThrow(ForbiddenException);
		expect(audit.recorded).toHaveLength(0);
	});

	it('fails closed when the audit trail cannot record', async () => {
		await rel.create('orgA', 'clientA');
		audit.failWith = new Error('audit store down');
		await expect(
			authz.ensureCanAccessClient(
				{ userId, orgId: 'orgA' },
				'clientA',
				'VIEW_PORTFOLIO'
			)
		).rejects.toThrow('audit store down');
	});
});
