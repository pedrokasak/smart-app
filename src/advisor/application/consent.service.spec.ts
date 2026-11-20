import {
	ConflictException,
	ForbiddenException,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import {
	AdvisorType,
	ConsentStatus,
	InviteStatus,
	OrgRole,
	RelationshipStatus,
} from '../domain/enums';
import { CONSENT_TEXT_VERSION } from '../domain/invite-rules';
import { AuthorizationService } from './authorization.service';
import {
	CONSENT_CHANGED_EVENT,
	CONSENT_GRANTED_EVENT,
	CONSENT_REVOKED_EVENT,
	ConsentService,
	INVITE_DECLINED_EVENT,
	InvalidPortfolioSelectionError,
	InviteNotFoundError,
} from './consent.service';
import {
	InMemoryClientProfileStore,
	InMemoryConsentStore,
	InMemoryInviteeIdentity,
	InMemoryInviteNotifier,
	InMemoryInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryRelationshipStore,
	InMemorySharedPortfolioSource,
} from './in-memory-stores.fixture';
import { InviteService } from './invite.service';
import { RelationshipService } from './relationship.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];
	failWith?: Error;

	async record(event: AuditEventInput): Promise<void> {
		if (this.failWith) throw this.failWith;
		this.recorded.push(event);
	}

	ofType(type: string): AuditEventInput[] {
		return this.recorded.filter((e) => e.type === type);
	}
}

const DAY_MS = 24 * 60 * 60 * 1000;
const INVESTOR = 'inv-1';
const OTHER_INVESTOR = 'inv-2';

describe('ConsentService', () => {
	let memberships: InMemoryMembershipStore;
	let relationships: InMemoryRelationshipStore;
	let profiles: InMemoryClientProfileStore;
	let invites: InMemoryInviteStore;
	let consents: InMemoryConsentStore;
	let notifier: InMemoryInviteNotifier;
	let audit: FakeAuditTrail;
	let identity: InMemoryInviteeIdentity;
	let source: InMemorySharedPortfolioSource;
	let authz: AuthorizationService;
	let inviteService: InviteService;
	let service: ConsentService;
	let ctxA: { userId: string; orgId: string };
	let ctxB: { userId: string; orgId: string };

	beforeEach(async () => {
		memberships = new InMemoryMembershipStore();
		relationships = new InMemoryRelationshipStore();
		profiles = new InMemoryClientProfileStore();
		invites = new InMemoryInviteStore();
		consents = new InMemoryConsentStore();
		notifier = new InMemoryInviteNotifier();
		audit = new FakeAuditTrail();
		identity = new InMemoryInviteeIdentity();
		source = new InMemorySharedPortfolioSource();
		const orgs = new InMemoryOrganizationStore();
		const orgA = await orgs.create({
			name: 'Org A',
			advisorType: AdvisorType.Consultor,
		});
		const orgB = await orgs.create({
			name: 'Org B',
			advisorType: AdvisorType.Assessor,
		});
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

		identity.set(INVESTOR, {
			email: 'Joao@Exemplo.com',
			emailVerified: true,
		});
		identity.set(OTHER_INVESTOR, {
			email: 'maria@exemplo.com',
			emailVerified: true,
		});
		source.add(INVESTOR, { id: 'p1', name: 'Principal' });
		source.add(INVESTOR, { id: 'p2', name: 'Aposentadoria' });
		source.add(OTHER_INVESTOR, { id: 'p9', name: 'Da Maria' });

		const relationshipService = new RelationshipService(relationships);
		authz = new AuthorizationService(memberships, relationships, audit);
		inviteService = new InviteService(
			authz,
			relationshipService,
			invites,
			orgs,
			profiles,
			notifier,
			audit
		);
		service = new ConsentService(
			invites,
			consents,
			relationships,
			relationshipService,
			profiles,
			orgs,
			identity,
			source,
			audit
		);
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	/** Real invite via InviteService; returns the plain token it e-mailed. */
	const invited = async (email = 'joao@exemplo.com', ctx = ctxA) => {
		const created = await inviteService.createInvite(ctx, {
			email,
			clientName: 'Joao Silva',
		});
		const invite = await invites.findById(ctx.orgId, created.inviteId);
		return {
			...created,
			orgId: ctx.orgId,
			relationshipId: invite.relationshipId,
			token: notifier.sent[notifier.sent.length - 1].token,
		};
	};

	type Invited = Awaited<ReturnType<typeof invited>>;

	const snapshot = async (inv: Invited) =>
		JSON.stringify({
			invite: await invites.findById(inv.orgId, inv.inviteId),
			relationships: relationships.all,
			consents: await consents.listByRelationship(inv.relationshipId),
			profile: await profiles.findById(inv.clientProfileId),
			audit: audit.recorded.length,
		});

	const errorOf = async (promise: Promise<unknown>): Promise<unknown> => {
		try {
			await promise;
		} catch (error) {
			return error;
		}
		throw new Error('expected the promise to reject');
	};

	const reasonOf = async (promise: Promise<unknown>): Promise<unknown> => {
		const error = await errorOf(promise);
		expect(error).toBeInstanceOf(InvalidPortfolioSelectionError);
		return (error as InvalidPortfolioSelectionError).getResponse();
	};

	const relationshipOf = (inv: Invited) =>
		relationships.all.find((r) => r.id === inv.relationshipId);

	const accept = async (portfolioIds = ['p1', 'p2']) => {
		const inv = await invited();
		const grant = await service.acceptInvite(INVESTOR, inv.token, portfolioIds);
		return { inv, grant };
	};

	describe('previewInvite', () => {
		it('shows the org, the masked e-mail and the user portfolios without changing anything', async () => {
			const inv = await invited();
			const before = await snapshot(inv);

			const preview = await service.previewInvite(INVESTOR, inv.token);

			expect(preview).toEqual({
				organizationName: 'Org A',
				advisorType: AdvisorType.Consultor,
				invitedEmailMasked: 'jo***@ex***.com',
				expiresAt: inv.expiresAt,
				portfolios: [
					{ id: 'p1', name: 'Principal' },
					{ id: 'p2', name: 'Aposentadoria' },
				],
				consentTextVersion: CONSENT_TEXT_VERSION,
			});
			expect(await snapshot(inv)).toBe(before);
		});
	});

	describe('invite gate', () => {
		const expectUniformNotFound = async (
			inv: Invited,
			userId: string,
			token: string
		) => {
			const before = await snapshot(inv);
			const message = new InviteNotFoundError().message;
			for (const attempt of [
				() => service.previewInvite(userId, token),
				() => service.acceptInvite(userId, token, ['p1']),
				() => service.declineInvite(userId, token),
			]) {
				const error = await errorOf(attempt());
				expect(error).toBeInstanceOf(InviteNotFoundError);
				expect((error as Error).message).toBe(message);
			}
			expect(await snapshot(inv)).toBe(before);
		};

		it('rejects an unknown token', async () => {
			const inv = await invited();
			await expectUniformNotFound(inv, INVESTOR, 'not-a-real-token');
		});

		it('rejects an account with another e-mail', async () => {
			const inv = await invited();
			await expectUniformNotFound(inv, OTHER_INVESTOR, inv.token);
		});

		it('rejects the right e-mail when it is not verified', async () => {
			const inv = await invited();
			identity.set(INVESTOR, {
				email: 'joao@exemplo.com',
				emailVerified: false,
			});
			await expectUniformNotFound(inv, INVESTOR, inv.token);
		});

		it('rejects an unknown account and an account without e-mail', async () => {
			const inv = await invited();
			await expectUniformNotFound(inv, 'nobody', inv.token);
			identity.set(INVESTOR, { email: undefined, emailVerified: true });
			await expectUniformNotFound(inv, INVESTOR, inv.token);
		});

		it('rejects a non-string token', async () => {
			const inv = await invited();
			await expectUniformNotFound(inv, INVESTOR, undefined);
		});

		it('rejects a cancelled invite', async () => {
			const inv = await invited();
			await inviteService.cancelInvite(ctxA, inv.inviteId);
			await expectUniformNotFound(inv, INVESTOR, inv.token);
		});

		it('rejects an invite already accepted', async () => {
			const inv = await invited();
			await service.acceptInvite(INVESTOR, inv.token, ['p1']);
			await expectUniformNotFound(inv, INVESTOR, inv.token);
		});

		it('rejects an expired invite and marks it EXPIRED', async () => {
			const inv = await invited();
			jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
			jest.setSystemTime(Date.now() + 8 * DAY_MS);

			const error = await errorOf(service.previewInvite(INVESTOR, inv.token));

			expect(error).toBeInstanceOf(InviteNotFoundError);
			expect((error as Error).message).toBe(new InviteNotFoundError().message);
			const invite = await invites.findById(inv.orgId, inv.inviteId);
			expect(invite.status).toBe(InviteStatus.Expired);
			expect(relationshipOf(inv).status).toBe(RelationshipStatus.Pending);
			expect(await consents.listByRelationship(inv.relationshipId)).toEqual([]);
			await expectUniformNotFound(inv, INVESTOR, inv.token);
		});
	});

	describe('acceptInvite', () => {
		it('spends the invite, owns the profile, grants v1 and activates the relationship', async () => {
			const { inv, grant } = await accept();

			expect((await invites.findById(inv.orgId, inv.inviteId)).status).toBe(
				InviteStatus.Accepted
			);
			expect((await profiles.findById(inv.clientProfileId)).ownerUserId).toBe(
				INVESTOR
			);
			const [consent] = await consents.listByRelationship(inv.relationshipId);
			expect(consent).toMatchObject({
				orgId: inv.orgId,
				clientProfileId: inv.clientProfileId,
				relationshipId: inv.relationshipId,
				userId: INVESTOR,
				portfolioIds: ['p1', 'p2'],
				version: 1,
				textVersion: CONSENT_TEXT_VERSION,
				status: ConsentStatus.Active,
			});
			expect(relationshipOf(inv)).toMatchObject({
				status: RelationshipStatus.Active,
				consentId: consent.id,
			});
			expect(grant).toEqual({
				relationshipId: inv.relationshipId,
				organizationName: 'Org A',
				advisorType: AdvisorType.Consultor,
				portfolioIds: ['p1', 'p2'],
				grantedAt: consent.grantedAt,
				consentVersion: 1,
			});

			await expect(
				authz.ensureCanAccessClient(ctxA, inv.clientProfileId, 'VIEW_PORTFOLIO')
			).resolves.toBeUndefined();
		});

		it('audits the grant with counts only (no e-mail, name or portfolio id)', async () => {
			const { inv } = await accept();

			const [event] = audit.ofType(CONSENT_GRANTED_EVENT);
			expect(event.subject).toBe(inv.clientProfileId);
			expect(event.payload).toEqual({
				orgId: inv.orgId,
				portfolioCount: 2,
				consentVersion: 1,
			});
			const serialized = JSON.stringify(event).toLowerCase();
			for (const forbidden of [
				'joao',
				'exemplo',
				'silva',
				'principal',
				'aposentadoria',
				'"p1"',
				'"p2"',
			]) {
				expect(serialized).not.toContain(forbidden);
			}
		});

		it('rejects a portfolio of another user and writes nothing', async () => {
			const inv = await invited();
			const before = await snapshot(inv);

			expect(
				await reasonOf(service.acceptInvite(INVESTOR, inv.token, ['p1', 'p9']))
			).toEqual({ reason: 'NOT_OWNED' });

			expect(await snapshot(inv)).toBe(before);
			expect((await invites.findById(inv.orgId, inv.inviteId)).status).toBe(
				InviteStatus.Pending
			);
			expect(relationshipOf(inv).status).toBe(RelationshipStatus.Pending);
			expect(await consents.listByRelationship(inv.relationshipId)).toEqual([]);
		});

		it('rejects an empty selection', async () => {
			const inv = await invited();
			expect(
				await reasonOf(service.acceptInvite(INVESTOR, inv.token, []))
			).toEqual({ reason: 'EMPTY' });
			expect(
				await reasonOf(service.acceptInvite(INVESTOR, inv.token, undefined))
			).toEqual({ reason: 'EMPTY' });
		});

		it('lets only one of two parallel accepts of the same token win', async () => {
			const inv = await invited();

			const results = await Promise.allSettled([
				service.acceptInvite(INVESTOR, inv.token, ['p1']),
				service.acceptInvite(INVESTOR, inv.token, ['p2']),
			]);

			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			const rejected = results.filter(
				(r): r is PromiseRejectedResult => r.status === 'rejected'
			);
			expect(rejected).toHaveLength(1);
			expect(rejected[0].reason).toBeInstanceOf(InviteNotFoundError);
			expect(
				await consents.listByRelationship(inv.relationshipId)
			).toHaveLength(1);
			expect(audit.ofType(CONSENT_GRANTED_EVENT)).toHaveLength(1);
		});

		it('refuses a second invite from an org the user is already linked to', async () => {
			await accept();
			const second = await invited();

			const error = await errorOf(
				service.acceptInvite(INVESTOR, second.token, ['p1'])
			);

			expect(error).toBeInstanceOf(ConflictException);
			expect(error).not.toBeInstanceOf(InviteNotFoundError);
			expect(
				(await invites.findById(second.orgId, second.inviteId)).status
			).toBe(InviteStatus.Pending);
			expect(relationshipOf(second).status).toBe(RelationshipStatus.Pending);
		});

		it('still accepts an invite from another org', async () => {
			await accept();
			const fromB = await invited('joao@exemplo.com', ctxB);

			const grant = await service.acceptInvite(INVESTOR, fromB.token, ['p2']);

			expect(grant.organizationName).toBe('Org B');
			expect(relationshipOf(fromB).status).toBe(RelationshipStatus.Active);
		});

		it('records the matching revoke when activation fails after the grant was audited', async () => {
			const inv = await invited();
			jest.spyOn(relationships, 'activate').mockResolvedValueOnce(null);

			await expect(
				service.acceptInvite(INVESTOR, inv.token, ['p1'])
			).rejects.toBeInstanceOf(ConflictException);

			expect(audit.ofType(CONSENT_GRANTED_EVENT)).toHaveLength(1);
			const [revokedEvent] = audit.ofType(CONSENT_REVOKED_EVENT);
			expect(revokedEvent.subject).toBe(inv.clientProfileId);
			expect(revokedEvent.payload).toEqual({ orgId: inv.orgId });
			expect(
				await consents.findActiveByRelationship(inv.relationshipId)
			).toBeNull();
			expect(relationshipOf(inv).status).toBe(RelationshipStatus.Revoked);
		});

		it('records no revoke event when the grant audit itself failed', async () => {
			const inv = await invited();
			audit.failWith = new Error('audit down');

			await expect(
				service.acceptInvite(INVESTOR, inv.token, ['p1'])
			).rejects.toThrow('audit down');

			audit.failWith = undefined;
			expect(audit.ofType(CONSENT_REVOKED_EVENT)).toEqual([]);
		});

		it('rolls back when the audit fails: error propagates, nothing stays active', async () => {
			const inv = await invited();
			const failure = new Error('audit down');
			audit.failWith = failure;

			await expect(
				service.acceptInvite(INVESTOR, inv.token, ['p1'])
			).rejects.toBe(failure);

			expect(relationshipOf(inv).status).not.toBe(RelationshipStatus.Active);
			expect(relationshipOf(inv).status).toBe(RelationshipStatus.Revoked);
			const all = await consents.listByRelationship(inv.relationshipId);
			expect(all.filter((c) => c.status === ConsentStatus.Active)).toEqual([]);
			// The token is spent: it cannot be retried.
			expect((await invites.findById(inv.orgId, inv.inviteId)).status).toBe(
				InviteStatus.Accepted
			);
			audit.failWith = undefined;
			await expect(
				authz.ensureCanAccessClient(ctxA, inv.clientProfileId, 'VIEW_PORTFOLIO')
			).rejects.toBeInstanceOf(ForbiddenException);
		});
	});

	describe('declineInvite', () => {
		it('declines the invite, revokes the relationship and keeps the advisor out', async () => {
			const inv = await invited();

			await service.declineInvite(INVESTOR, inv.token);

			expect((await invites.findById(inv.orgId, inv.inviteId)).status).toBe(
				InviteStatus.Declined
			);
			expect(relationshipOf(inv).status).toBe(RelationshipStatus.Revoked);
			expect(await consents.listByRelationship(inv.relationshipId)).toEqual([]);
			const [event] = audit.ofType(INVITE_DECLINED_EVENT);
			expect(event.subject).toBe(inv.clientProfileId);
			expect(event.payload).toEqual({ orgId: inv.orgId });
			await expect(
				authz.ensureCanAccessClient(ctxA, inv.clientProfileId, 'VIEW_PORTFOLIO')
			).rejects.toBeInstanceOf(ForbiddenException);
		});

		it('declines even when the audit fails, logging no e-mail', async () => {
			const inv = await invited();
			audit.failWith = new Error('audit down');
			const logged = jest
				.spyOn(Logger.prototype, 'error')
				.mockImplementation(() => undefined);

			await expect(
				service.declineInvite(INVESTOR, inv.token)
			).resolves.toBeUndefined();

			expect((await invites.findById(inv.orgId, inv.inviteId)).status).toBe(
				InviteStatus.Declined
			);
			expect(relationshipOf(inv).status).toBe(RelationshipStatus.Revoked);
			expect(logged).toHaveBeenCalledTimes(1);
			for (const call of logged.mock.calls) {
				const text = call.map(String).join(' ').toLowerCase();
				expect(text).not.toContain('joao');
				expect(text).not.toContain('exemplo');
			}
			logged.mockRestore();
		});
	});

	describe('changeSharedPortfolios', () => {
		it('grants v2, supersedes v1 and points the relationship at v2', async () => {
			const { inv } = await accept(['p1']);

			const grant = await service.changeSharedPortfolios(
				INVESTOR,
				inv.relationshipId,
				['p2']
			);

			const [v1, v2] = await consents.listByRelationship(inv.relationshipId);
			expect(v1).toMatchObject({
				version: 1,
				status: ConsentStatus.Superseded,
			});
			expect(v2).toMatchObject({
				version: 2,
				status: ConsentStatus.Active,
				portfolioIds: ['p2'],
			});
			expect(relationshipOf(inv)).toMatchObject({
				status: RelationshipStatus.Active,
				consentId: v2.id,
			});
			expect(grant).toMatchObject({
				relationshipId: inv.relationshipId,
				portfolioIds: ['p2'],
				consentVersion: 2,
			});
			const [event] = audit.ofType(CONSENT_CHANGED_EVENT);
			expect(event.payload).toEqual({
				orgId: inv.orgId,
				portfolioCount: 1,
				consentVersion: 2,
			});
		});

		it('validates the new selection and writes nothing on failure', async () => {
			const { inv } = await accept(['p1']);
			const before = await snapshot(inv);

			expect(
				await reasonOf(
					service.changeSharedPortfolios(INVESTOR, inv.relationshipId, ['p9'])
				)
			).toEqual({ reason: 'NOT_OWNED' });

			expect(await snapshot(inv)).toBe(before);
		});

		it('is not found for another user and changes nothing', async () => {
			const { inv } = await accept(['p1']);
			const before = await snapshot(inv);

			await expect(
				service.changeSharedPortfolios(OTHER_INVESTOR, inv.relationshipId, [
					'p9',
				])
			).rejects.toBeInstanceOf(NotFoundException);

			expect(await snapshot(inv)).toBe(before);
		});

		it('grants nothing when the scope-change audit fails', async () => {
			const { inv } = await accept(['p1']);
			const [v1] = await consents.listByRelationship(inv.relationshipId);
			const failure = new Error('audit down');
			audit.failWith = failure;

			await expect(
				service.changeSharedPortfolios(INVESTOR, inv.relationshipId, ['p2'])
			).rejects.toBe(failure);

			const all = await consents.listByRelationship(inv.relationshipId);
			expect(all).toHaveLength(1);
			expect(all[0]).toMatchObject({
				id: v1.id,
				status: ConsentStatus.Active,
				portfolioIds: ['p1'],
			});
			expect(relationshipOf(inv)).toMatchObject({
				status: RelationshipStatus.Active,
				consentId: v1.id,
			});
		});

		it('cannot resurrect a link revoked while the change was in flight', async () => {
			const { inv } = await accept(['p1']);
			const listOwned = source.listOwned.bind(source);
			jest
				.spyOn(source, 'listOwned')
				.mockImplementationOnce(async (userId: string) => {
					// Interleaving: the investor revokes after the relationship read.
					await service.revoke(INVESTOR, inv.relationshipId);
					return listOwned(userId);
				});
			const logged = jest
				.spyOn(Logger.prototype, 'error')
				.mockImplementation(() => undefined);

			await expect(
				service.changeSharedPortfolios(INVESTOR, inv.relationshipId, ['p2'])
			).rejects.toBeInstanceOf(NotFoundException);

			expect(relationshipOf(inv).status).toBe(RelationshipStatus.Revoked);
			expect(
				await consents.findActiveByRelationship(inv.relationshipId)
			).toBeNull();
			await expect(
				authz.ensureCanAccessClient(ctxA, inv.clientProfileId, 'VIEW_PORTFOLIO')
			).rejects.toBeInstanceOf(ForbiddenException);
			for (const call of logged.mock.calls) {
				expect(String(call[0])).not.toContain('joao');
			}
			logged.mockRestore();
		});
	});

	describe('revoke', () => {
		it('revokes the consent and the relationship; the advisor loses access', async () => {
			const { inv } = await accept();

			await service.revoke(INVESTOR, inv.relationshipId);

			const [consent] = await consents.listByRelationship(inv.relationshipId);
			expect(consent.status).toBe(ConsentStatus.Revoked);
			expect(relationshipOf(inv).status).toBe(RelationshipStatus.Revoked);
			const [event] = audit.ofType(CONSENT_REVOKED_EVENT);
			expect(event.subject).toBe(inv.clientProfileId);
			expect(event.payload).toEqual({ orgId: inv.orgId });
			await expect(
				authz.ensureCanAccessClient(ctxA, inv.clientProfileId, 'VIEW_PORTFOLIO')
			).rejects.toBeInstanceOf(ForbiddenException);
		});

		it('is not found for another user and changes nothing', async () => {
			const { inv } = await accept();
			const before = await snapshot(inv);

			await expect(
				service.revoke(OTHER_INVESTOR, inv.relationshipId)
			).rejects.toBeInstanceOf(NotFoundException);
			await expect(
				service.revoke(INVESTOR, 'unknown-relationship')
			).rejects.toBeInstanceOf(NotFoundException);

			expect(await snapshot(inv)).toBe(before);
		});

		it('stands even when the audit fails', async () => {
			const { inv } = await accept();
			audit.failWith = new Error('audit down');
			const logged = jest
				.spyOn(Logger.prototype, 'error')
				.mockImplementation(() => undefined);

			await expect(
				service.revoke(INVESTOR, inv.relationshipId)
			).resolves.toBeUndefined();

			expect(logged).toHaveBeenCalledTimes(1);
			expect(String(logged.mock.calls[0][0])).not.toContain('joao');
			logged.mockRestore();

			const [consent] = await consents.listByRelationship(inv.relationshipId);
			expect(consent.status).toBe(ConsentStatus.Revoked);
			expect(relationshipOf(inv).status).toBe(RelationshipStatus.Revoked);
		});
	});

	describe('listMyGrants', () => {
		it('lists only the user active links', async () => {
			const { inv } = await accept(['p1']);
			const fromB = await invited('joao@exemplo.com', ctxB);
			await service.acceptInvite(INVESTOR, fromB.token, ['p2']);
			await service.revoke(INVESTOR, fromB.relationshipId);
			const maria = await invited('maria@exemplo.com', ctxB);
			await service.acceptInvite(OTHER_INVESTOR, maria.token, ['p9']);

			const grants = await service.listMyGrants(INVESTOR);

			expect(grants).toEqual([
				expect.objectContaining({
					relationshipId: inv.relationshipId,
					organizationName: 'Org A',
					advisorType: AdvisorType.Consultor,
					portfolioIds: ['p1'],
					consentVersion: 1,
				}),
			]);
		});
	});

	describe('revokeAllForUser', () => {
		it('revokes every active link of the user', async () => {
			const { inv } = await accept(['p1']);
			const fromB = await invited('joao@exemplo.com', ctxB);
			await service.acceptInvite(INVESTOR, fromB.token, ['p2']);
			const maria = await invited('maria@exemplo.com', ctxB);
			await service.acceptInvite(OTHER_INVESTOR, maria.token, ['p9']);

			expect(await service.revokeAllForUser(INVESTOR)).toEqual({ revoked: 2 });

			expect(relationshipOf(inv).status).toBe(RelationshipStatus.Revoked);
			expect(relationshipOf(fromB).status).toBe(RelationshipStatus.Revoked);
			expect(relationshipOf(maria).status).toBe(RelationshipStatus.Active);
			expect(await service.listMyGrants(INVESTOR)).toEqual([]);
			expect(await service.listMyGrants(OTHER_INVESTOR)).toHaveLength(1);
		});

		it('keeps going when one link fails and rethrows the first error at the end', async () => {
			const { inv } = await accept(['p1']);
			const fromB = await invited('joao@exemplo.com', ctxB);
			await service.acceptInvite(INVESTOR, fromB.token, ['p2']);
			const failure = new Error('store down');
			jest.spyOn(consents, 'revokeActive').mockRejectedValueOnce(failure);
			const logged = jest
				.spyOn(Logger.prototype, 'error')
				.mockImplementation(() => undefined);

			await expect(service.revokeAllForUser(INVESTOR)).rejects.toBe(failure);

			// Both relationships (the access gate) are ended; the second consent too.
			expect(relationshipOf(inv).status).toBe(RelationshipStatus.Revoked);
			expect(relationshipOf(fromB).status).toBe(RelationshipStatus.Revoked);
			expect(await consents.listActiveByUser(INVESTOR)).toHaveLength(1);
			logged.mockRestore();

			// A retry finishes the job.
			expect(await service.revokeAllForUser(INVESTOR)).toEqual({ revoked: 1 });
			expect(await consents.listActiveByUser(INVESTOR)).toEqual([]);
		});

		it('returns zero when there is nothing to revoke', async () => {
			expect(await service.revokeAllForUser(INVESTOR)).toEqual({ revoked: 0 });
		});
	});
});
