import {
	ForbiddenException,
	NotFoundException,
	UnprocessableEntityException,
} from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import {
	AdvisorType,
	InviteStatus,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
} from '../domain/enums';
import { hashInviteToken } from '../domain/invite-rules';
import { AuthorizationService } from './authorization.service';
import {
	InMemoryClientProfileStore,
	InMemoryInviteNotifier,
	InMemoryInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryRelationshipStore,
} from './in-memory-stores.fixture';
import {
	INVITE_CREATED_EVENT,
	InvalidInviteError,
	InviteConflictError,
	InviteService,
} from './invite.service';
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

const DAY_MS = 24 * 60 * 60 * 1000;

describe('InviteService', () => {
	let relationships: InMemoryRelationshipStore;
	let profiles: InMemoryClientProfileStore;
	let invites: InMemoryInviteStore;
	let notifier: InMemoryInviteNotifier;
	let audit: FakeAuditTrail;
	let service: InviteService;
	let orgAId: string;
	let ctxA: { userId: string; orgId: string };
	let ctxB: { userId: string; orgId: string };

	beforeEach(async () => {
		const memberships = new InMemoryMembershipStore();
		relationships = new InMemoryRelationshipStore();
		profiles = new InMemoryClientProfileStore();
		invites = new InMemoryInviteStore();
		notifier = new InMemoryInviteNotifier();
		audit = new FakeAuditTrail();
		const orgs = new InMemoryOrganizationStore();
		const orgA = await orgs.create({
			name: 'Org A',
			advisorType: AdvisorType.Assessor,
		});
		const orgB = await orgs.create({
			name: 'Org B',
			advisorType: AdvisorType.Assessor,
		});
		orgAId = orgA.id;
		ctxA = { userId: 'adv-1', orgId: orgA.id };
		ctxB = { userId: 'adv-2', orgId: orgB.id };
		await memberships.create({
			userId: ctxA.userId,
			orgId: orgA.id,
			role: OrgRole.Advisor,
		});
		await memberships.create({
			userId: ctxB.userId,
			orgId: orgB.id,
			role: OrgRole.OrgAdmin,
		});
		service = new InviteService(
			new AuthorizationService(memberships, relationships, audit),
			new RelationshipService(relationships),
			invites,
			orgs,
			profiles,
			notifier,
			audit
		);
	});

	const create = (
		over: Partial<{ email: string; clientName: string }> = {},
		ctx = ctxA
	) =>
		service.createInvite(ctx, {
			email: 'Joao@Exemplo.com',
			clientName: '  Joao Silva ',
			...over,
		});

	const reasonOf = async (promise: Promise<unknown>): Promise<unknown> => {
		try {
			await promise;
		} catch (error) {
			return (error as InviteConflictError).getResponse();
		}
		return undefined;
	};

	describe('createInvite', () => {
		it('creates profile, PENDING relationship and invite, and sends the token', async () => {
			const before = Date.now();
			const result = await create();

			const profile = await profiles.findById(result.clientProfileId);
			expect(profile).toMatchObject({
				orgId: orgAId,
				name: 'Joao Silva',
				origin: ProfileOrigin.ClientCreated,
			});
			expect(profile.ownerUserId).toBeUndefined();

			const relationship = await relationships.findByOrgAndClient(
				orgAId,
				result.clientProfileId
			);
			expect(relationship.status).toBe(RelationshipStatus.Pending);

			const invite = await invites.findById(orgAId, result.inviteId);
			expect(invite).toMatchObject({
				status: InviteStatus.Pending,
				email: 'joao@exemplo.com',
				resendCount: 0,
				invitedByUserId: ctxA.userId,
				relationshipId: relationship.id,
			});
			expect(
				Math.abs(invite.expiresAt.getTime() - before - 7 * DAY_MS)
			).toBeLessThan(10_000);
			expect(result.expiresAt).toEqual(invite.expiresAt);

			expect(notifier.sent).toHaveLength(1);
			expect(notifier.sent[0]).toMatchObject({
				to: 'joao@exemplo.com',
				orgName: 'Org A',
				expiresAt: invite.expiresAt,
			});
			expect(hashInviteToken(notifier.sent[0].token)).toBe(invite.tokenHash);
		});

		it('never returns the token nor its hash', async () => {
			const result = await create();
			const json = JSON.stringify(result);
			expect(Object.keys(result).sort()).toEqual([
				'clientProfileId',
				'expiresAt',
				'inviteId',
			]);
			expect(json).not.toContain(notifier.sent[0].token);
			expect(json).not.toContain(hashInviteToken(notifier.sent[0].token));
		});

		it('rejects a non member and creates and sends nothing', async () => {
			const input = { email: 'a@b.com', clientName: 'X' };
			await expect(
				service.createInvite({ userId: 'stranger', orgId: orgAId }, input)
			).rejects.toThrow(ForbiddenException);
			await expect(
				service.createInvite({ userId: ctxB.userId, orgId: orgAId }, input)
			).rejects.toThrow(ForbiddenException);
			expect(notifier.attempts).toHaveLength(0);
			expect(audit.recorded).toHaveLength(0);
			expect(await invites.findPendingByOrgAndEmail(orgAId, 'a@b.com')).toEqual(
				[]
			);
		});

		it.each([
			['an invalid e-mail', { email: 'not-an-email' }, 'INVALID_EMAIL'],
			['an empty name', { clientName: '   ' }, 'INVALID_NAME'],
			['a 121 chars name', { clientName: 'x'.repeat(121) }, 'INVALID_NAME'],
		])('rejects %s and creates nothing', async (_label, over, reason) => {
			const promise = create(over);
			await expect(promise).rejects.toThrow(InvalidInviteError);
			await expect(promise).rejects.toThrow(UnprocessableEntityException);
			expect(await reasonOf(promise)).toEqual({ reason });
			expect(notifier.attempts).toHaveLength(0);
			expect(audit.recorded).toHaveLength(0);
			expect(await relationships.findByOrgAndClient(orgAId, 'any')).toBeNull();
		});

		it('accepts a name of exactly 120 chars', async () => {
			await expect(
				create({ clientName: 'x'.repeat(120) })
			).resolves.toBeTruthy();
		});

		it('refuses a second live invite of the same org for the same e-mail', async () => {
			await create();
			const second = create({ email: 'JOAO@exemplo.COM' });
			await expect(second).rejects.toThrow(InviteConflictError);
			expect(await reasonOf(second)).toEqual({ reason: 'PENDING_INVITE' });
			expect(notifier.sent).toHaveLength(1);
		});

		it('accepts the same e-mail from another org', async () => {
			await create();
			await expect(create({}, ctxB)).resolves.toBeTruthy();
			expect(notifier.sent).toHaveLength(2);
		});

		it('expires a lapsed previous invite and creates the new one', async () => {
			const first = await create();
			jest.useFakeTimers({
				now: Date.now() + 8 * DAY_MS,
				doNotFake: ['setImmediate', 'nextTick'],
			});
			let second: { inviteId: string };
			try {
				second = await create();
			} finally {
				jest.useRealTimers();
			}
			expect(second.inviteId).not.toBe(first.inviteId);
			const old = await invites.findById(orgAId, first.inviteId);
			expect(old.status).toBe(InviteStatus.Expired);
		});

		it('cancels the invite and revokes the relationship when the e-mail fails', async () => {
			notifier.failWith = new Error('smtp down');
			await expect(create()).rejects.toThrow('smtp down');

			const invite = await invites.findByTokenHash(
				hashInviteToken(notifier.attempts[0].token)
			);
			expect(invite.status).toBe(InviteStatus.Cancelled);
			const relationship = await relationships.findById(invite.relationshipId);
			expect(relationship.status).toBe(RelationshipStatus.Revoked);
			expect(audit.recorded).toHaveLength(1);
		});

		it('writes the audit event before sending and keeps PII out of it', async () => {
			const order: string[] = [];
			const record = audit.record.bind(audit);
			audit.record = async (event) => {
				order.push('audit');
				return record(event);
			};
			const send = notifier.sendInvite.bind(notifier);
			notifier.sendInvite = async (input) => {
				order.push('send');
				return send(input);
			};

			const result = await create();

			expect(order).toEqual(['audit', 'send']);
			expect(audit.recorded).toHaveLength(1);
			const event = audit.recorded[0];
			expect(event.type).toBe(INVITE_CREATED_EVENT);
			expect(event.subject).toBe(result.clientProfileId);
			expect(event.payload).toEqual({ orgId: orgAId });
			const json = JSON.stringify(event.payload);
			expect(json).not.toContain('joao');
			expect(json).not.toContain('Silva');
		});

		it('sends nothing when the audit fails', async () => {
			audit.failWith = new Error('audit down');
			await expect(create()).rejects.toThrow('audit down');
			expect(notifier.attempts).toHaveLength(0);
		});
	});

	describe('resendInvite', () => {
		it('invalidates the old token and bumps resendCount', async () => {
			const { inviteId } = await create();
			const oldToken = notifier.sent[0].token;

			const result = await service.resendInvite(ctxA, inviteId);

			const invite = await invites.findById(orgAId, inviteId);
			expect(invite.resendCount).toBe(1);
			expect(result.expiresAt).toEqual(invite.expiresAt);
			expect(
				await invites.findByTokenHash(hashInviteToken(oldToken))
			).toBeNull();
			expect(notifier.sent).toHaveLength(2);
			const newToken = notifier.sent[1].token;
			expect(newToken).not.toBe(oldToken);
			expect(hashInviteToken(newToken)).toBe(invite.tokenHash);
			expect(JSON.stringify(result)).not.toContain(newToken);
		});

		it('refuses the fourth resend with RESEND_LIMIT', async () => {
			const { inviteId } = await create();
			for (let i = 0; i < 3; i += 1) {
				await service.resendInvite(ctxA, inviteId);
			}
			const fourth = service.resendInvite(ctxA, inviteId);
			await expect(fourth).rejects.toThrow(InviteConflictError);
			expect(await reasonOf(fourth)).toEqual({ reason: 'RESEND_LIMIT' });
			expect(notifier.sent).toHaveLength(4);
		});

		it('hides an invite of another org behind NotFound', async () => {
			const { inviteId } = await create();
			await expect(service.resendInvite(ctxB, inviteId)).rejects.toThrow(
				NotFoundException
			);
			expect(notifier.sent).toHaveLength(1);
		});

		it('refuses a non member', async () => {
			const { inviteId } = await create();
			await expect(
				service.resendInvite({ userId: 'x', orgId: orgAId }, inviteId)
			).rejects.toThrow(ForbiddenException);
		});

		it('answers NOT_PENDING for an accepted invite', async () => {
			const { inviteId } = await create();
			await invites.transition(inviteId, InviteStatus.Accepted, new Date());
			const resend = service.resendInvite(ctxA, inviteId);
			await expect(resend).rejects.toThrow(InviteConflictError);
			expect(await reasonOf(resend)).toEqual({ reason: 'NOT_PENDING' });
			expect(notifier.sent).toHaveLength(1);
		});
	});

	describe('cancelInvite', () => {
		it('cancels the invite and revokes the PENDING relationship', async () => {
			const { inviteId, clientProfileId } = await create();
			await service.cancelInvite(ctxA, inviteId);

			const invite = await invites.findById(orgAId, inviteId);
			expect(invite.status).toBe(InviteStatus.Cancelled);
			const relationship = await relationships.findByOrgAndClient(
				orgAId,
				clientProfileId
			);
			expect(relationship.status).toBe(RelationshipStatus.Revoked);
		});

		it('answers NOT_PENDING the second time', async () => {
			const { inviteId } = await create();
			await service.cancelInvite(ctxA, inviteId);
			const again = service.cancelInvite(ctxA, inviteId);
			await expect(again).rejects.toThrow(InviteConflictError);
			expect(await reasonOf(again)).toEqual({ reason: 'NOT_PENDING' });
		});

		it('hides an invite of another org behind NotFound', async () => {
			const { inviteId } = await create();
			await expect(service.cancelInvite(ctxB, inviteId)).rejects.toThrow(
				NotFoundException
			);
			const invite = await invites.findById(orgAId, inviteId);
			expect(invite.status).toBe(InviteStatus.Pending);
		});
	});
});
