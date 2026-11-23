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
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
	InMemoryInviteNotifier,
	InMemoryInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryRelationshipStore,
	RecordingAttentionPurge,
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
	let memberships: InMemoryMembershipStore;
	let relationships: InMemoryRelationshipStore;
	let profiles: InMemoryClientProfileStore;
	let invites: InMemoryInviteStore;
	let assignments: InMemoryAssignmentStore;
	let notifier: InMemoryInviteNotifier;
	let audit: FakeAuditTrail;
	let service: InviteService;
	let purge: RecordingAttentionPurge;
	let orgAId: string;
	let ctxA: { userId: string; orgId: string };
	let ctxB: { userId: string; orgId: string };

	beforeEach(async () => {
		memberships = new InMemoryMembershipStore();
		assignments = new InMemoryAssignmentStore();
		relationships = new InMemoryRelationshipStore(assignments);
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
			new AuthorizationService(
				memberships,
				relationships,
				profiles,
				assignments,
				audit
			),
			new RelationshipService(relationships),
			invites,
			orgs,
			profiles,
			notifier,
			assignments,
			audit,
			(purge = new RecordingAttentionPurge())
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

	/** Nada do convite sobrou: nem perfil, nem relação, nem convite, nem atribuição. */
	const expectNothingLeft = () => {
		expect(profiles.size).toBe(0);
		expect(relationships.size).toBe(0);
		expect(invites.size).toBe(0);
		expect(assignments.size).toBe(0);
	};

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
			[
				'a name with BEL (U+0007)',
				{ clientName: 'Joao\u0007' },
				'INVALID_NAME',
			],
			[
				'a name with RLO (U+202E)',
				{ clientName: 'Joao‮Silva' },
				'INVALID_NAME',
			],
		])('rejects %s and creates nothing', async (_label, over, reason) => {
			const promise = create(over);
			await expect(promise).rejects.toThrow(InvalidInviteError);
			await expect(promise).rejects.toThrow(UnprocessableEntityException);
			expect(await reasonOf(promise)).toEqual({ reason });
			expect(notifier.attempts).toHaveLength(0);
			expect(audit.recorded).toHaveLength(0);
			expect(profiles.size).toBe(0);
			expect(relationships.size).toBe(0);
			expect(invites.size).toBe(0);
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

		it('apaga perfil, relação e convite quando o e-mail falha', async () => {
			notifier.failWith = new Error('smtp down');
			await expect(create()).rejects.toThrow('smtp down');

			expect(
				await invites.findByTokenHash(
					hashInviteToken(notifier.attempts[0].token)
				)
			).toBeNull();
			expect(audit.recorded).toHaveLength(1);
			expectNothingLeft();
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

		it('purges the attention read model of the undone profile', async () => {
			audit.failWith = new Error('audit down');
			await expect(create()).rejects.toThrow('audit down');
			expect(purge.purged).toHaveLength(1);
			expect(purge.purged[0]).toMatch(new RegExp(`^${ctxA.orgId}:`));
		});

		it('cleans up when the audit fails and lets a retry succeed', async () => {
			audit.failWith = new Error('audit down');
			await expect(create()).rejects.toThrow('audit down');
			expect(notifier.attempts).toHaveLength(0);
			expectNothingLeft();

			audit.failWith = undefined;
			await expect(create()).resolves.toBeTruthy();
			expect(notifier.sent).toHaveLength(1);
		});

		it('throws and sends nothing when the organization does not exist', async () => {
			await memberships.create({
				userId: 'ghost-user',
				orgId: 'ghost-org',
				role: OrgRole.Advisor,
			});
			await expect(
				create({}, { userId: 'ghost-user', orgId: 'ghost-org' })
			).rejects.toThrow();
			expect(notifier.attempts).toHaveLength(0);
			expect(profiles.size).toBe(0);
			expect(relationships.size).toBe(0);
			expect(invites.size).toBe(0);
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

		it('leaves the relationship ACTIVE when it was activated meanwhile', async () => {
			const { inviteId, clientProfileId } = await create();
			const invite = await invites.findById(orgAId, inviteId);
			await relationships.activate(invite.relationshipId, 'consent-1');

			await service.cancelInvite(ctxA, inviteId);

			expect((await invites.findById(orgAId, inviteId)).status).toBe(
				InviteStatus.Cancelled
			);
			const relationship = await relationships.findByOrgAndClient(
				orgAId,
				clientProfileId
			);
			expect(relationship.status).toBe(RelationshipStatus.Active);
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

	describe('atribuição', () => {
		const other = () => ({ userId: 'adv-3', orgId: orgAId });
		const admin = () => ({ userId: 'admin-a', orgId: orgAId });

		beforeEach(async () => {
			await memberships.create({
				userId: 'adv-3',
				orgId: orgAId,
				role: OrgRole.Advisor,
			});
			await memberships.create({
				userId: 'admin-a',
				orgId: orgAId,
				role: OrgRole.OrgAdmin,
			});
		});

		it('convite feito por ADVISOR nasce atribuído a ele', async () => {
			const { clientProfileId } = await create();

			expect(
				await assignments.listByClient(orgAId, clientProfileId)
			).toMatchObject([{ userId: ctxA.userId, assignedBy: ctxA.userId }]);
		});

		it('convite feito por ORG_ADMIN nasce sem atribuição', async () => {
			await create({}, admin());
			expect(assignments.size).toBe(0);
		});

		it('apaga tudo o que criou quando a atribuição falha', async () => {
			jest
				.spyOn(assignments, 'assign')
				.mockRejectedValueOnce(new Error('assign down'));

			await expect(create()).rejects.toThrow('assign down');

			expect(notifier.attempts).toHaveLength(0);
			expect(audit.recorded).toHaveLength(0);
			expectNothingLeft();
		});

		it('apaga tudo o que criou quando a auditoria falha', async () => {
			audit.failWith = new Error('audit down');
			await expect(create()).rejects.toThrow('audit down');
			expect(notifier.attempts).toHaveLength(0);
			expectNothingLeft();
		});

		it('apaga tudo o que criou quando o envio falha', async () => {
			notifier.failWith = new Error('smtp down');
			await expect(create()).rejects.toThrow('smtp down');
			expectNothingLeft();
		});

		it('ORG_ADMIN: apaga tudo o que criou quando o envio falha', async () => {
			notifier.failWith = new Error('smtp down');
			await expect(create({}, admin())).rejects.toThrow('smtp down');
			expectNothingLeft();
		});

		it('apaga tudo o que criou quando a criação do convite falha', async () => {
			jest
				.spyOn(invites, 'create')
				.mockRejectedValueOnce(new Error('invite store down'));
			await expect(create()).rejects.toThrow('invite store down');
			expect(notifier.attempts).toHaveLength(0);
			expectNothingLeft();
		});

		it('relança o erro original mesmo se um passo do desfazimento falhar', async () => {
			notifier.failWith = new Error('smtp down');
			jest
				.spyOn(invites, 'deleteByRelationshipIds')
				.mockRejectedValueOnce(new Error('delete down'));

			await expect(create()).rejects.toThrow('smtp down');

			// Os outros passos rodam mesmo com um falhando.
			expect(profiles.size).toBe(0);
			expect(relationships.size).toBe(0);
			expect(assignments.size).toBe(0);
		});

		it('não apaga outro cliente da org quando um convite falha', async () => {
			const kept = await create({ email: 'ana@exemplo.com' });
			notifier.failWith = new Error('smtp down');

			await expect(create()).rejects.toThrow('smtp down');

			expect(profiles.size).toBe(1);
			expect(relationships.size).toBe(1);
			expect(invites.size).toBe(1);
			expect(await profiles.findById(kept.clientProfileId)).not.toBeNull();
			expect(await invites.findById(orgAId, kept.inviteId)).not.toBeNull();
			expect(
				await assignments.isAssigned(orgAId, kept.clientProfileId, ctxA.userId)
			).toBe(true);
		});

		it('ADVISOR não reenvia nem cancela convite de cliente não atribuído: 404', async () => {
			const { inviteId } = await create();

			await expect(service.resendInvite(other(), inviteId)).rejects.toThrow(
				NotFoundException
			);
			await expect(service.cancelInvite(other(), inviteId)).rejects.toThrow(
				NotFoundException
			);
			expect(notifier.sent).toHaveLength(1);
			expect((await invites.findById(orgAId, inviteId)).status).toBe(
				InviteStatus.Pending
			);
		});

		it('ORG_ADMIN reenvia e cancela convite de qualquer cliente da org', async () => {
			const { inviteId } = await create();

			await service.resendInvite(admin(), inviteId);
			await service.cancelInvite(admin(), inviteId);

			expect(notifier.sent).toHaveLength(2);
			expect((await invites.findById(orgAId, inviteId)).status).toBe(
				InviteStatus.Cancelled
			);
		});
	});
});
