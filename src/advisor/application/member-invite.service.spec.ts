import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { AdvisorType, MemberInviteStatus, OrgRole } from '../domain/enums';
import { hashInviteToken } from '../domain/invite-rules';
import { AuthorizationService } from './authorization.service';
import {
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
	InMemoryInviteeIdentity,
	InMemoryMemberInviteNotifier,
	InMemoryMemberInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryPortalAccountDirectory,
	InMemoryRelationshipStore,
} from './in-memory-stores.fixture';
import { InvalidInviteError } from './invite.service';
import {
	MemberInviteConflictError,
	MemberInviteNotFoundError,
} from './member-invite-errors';
import {
	MEMBER_DECLINED_EVENT,
	MEMBER_INVITED_EVENT,
	MEMBER_JOINED_EVENT,
	MemberInviteService,
} from './member-invite.service';
import {
	DuplicateMembershipError,
	DuplicatePendingMemberInviteError,
} from './ports/store-errors';
import { RoleRequiredError } from './access-errors';

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
const ADMIN = 'admin-1';
const ADVISOR = 'adv-1';
const INVITEE = 'invitee-1';
const OTHER = 'other-1';

describe('MemberInviteService', () => {
	let memberships: InMemoryMembershipStore;
	let invites: InMemoryMemberInviteStore;
	let identity: InMemoryInviteeIdentity;
	let directory: InMemoryPortalAccountDirectory;
	let notifier: InMemoryMemberInviteNotifier;
	let audit: FakeAuditTrail;
	let service: MemberInviteService;
	let orgId: string;
	let otherOrgId: string;
	let adminCtx: { userId: string; orgId: string };

	beforeEach(async () => {
		memberships = new InMemoryMembershipStore();
		invites = new InMemoryMemberInviteStore();
		identity = new InMemoryInviteeIdentity();
		directory = new InMemoryPortalAccountDirectory();
		notifier = new InMemoryMemberInviteNotifier();
		audit = new FakeAuditTrail();
		const orgs = new InMemoryOrganizationStore();
		const assignments = new InMemoryAssignmentStore();
		const org = await orgs.create({
			name: 'Escritório A',
			advisorType: AdvisorType.Assessor,
			ownerUserId: ADMIN,
		});
		const other = await orgs.create({
			name: 'Escritório B',
			advisorType: AdvisorType.Consultor,
			ownerUserId: OTHER,
		});
		orgId = org.id;
		otherOrgId = other.id;
		adminCtx = { userId: ADMIN, orgId };
		await memberships.create({ userId: ADMIN, orgId, role: OrgRole.OrgAdmin });
		await memberships.create({ userId: ADVISOR, orgId, role: OrgRole.Advisor });
		await memberships.create({
			userId: OTHER,
			orgId: otherOrgId,
			role: OrgRole.OrgAdmin,
		});
		identity.set(INVITEE, { email: 'fulano@x.com', emailVerified: false });
		identity.set(OTHER, { email: 'outro@x.com', emailVerified: true });
		service = new MemberInviteService(
			new AuthorizationService(
				memberships,
				new InMemoryRelationshipStore(assignments),
				new InMemoryClientProfileStore(),
				assignments,
				audit
			),
			invites,
			memberships,
			orgs,
			directory,
			identity,
			notifier,
			audit
		);
	});

	const create = (email = 'fulano@x.com', ctx = adminCtx) =>
		service.createInvite(ctx, { email });

	/** Cria um convite e devolve o token que foi no e-mail. */
	const invite = async (email = 'fulano@x.com') => {
		const created = await create(email);
		return { ...created, token: notifier.sent[notifier.sent.length - 1].token };
	};

	const reasonOf = async (promise: Promise<unknown>): Promise<unknown> => {
		try {
			await promise;
		} catch (error) {
			return (error as MemberInviteConflictError).getResponse();
		}
		return undefined;
	};

	const statusOf = async (id: string) =>
		(await invites.findById(orgId, id))?.status;

	describe('createInvite', () => {
		it('grava um convite PENDING de ADVISOR com o e-mail normalizado e só o hash', async () => {
			const before = Date.now();
			const result = await create('  Fulano@X.com ');

			const stored = await invites.findById(orgId, result.inviteId);
			expect(stored).toMatchObject({
				orgId,
				email: 'fulano@x.com',
				role: OrgRole.Advisor,
				status: MemberInviteStatus.Pending,
				resendCount: 0,
				invitedByUserId: ADMIN,
			});
			const [mail] = notifier.sent;
			expect(mail).toMatchObject({
				to: 'fulano@x.com',
				orgName: 'Escritório A',
			});
			expect(stored?.tokenHash).toBe(hashInviteToken(mail.token));
			expect(JSON.stringify(stored)).not.toContain(mail.token);
			const ttl = result.expiresAt.getTime() - before;
			expect(ttl).toBeGreaterThanOrEqual(7 * DAY_MS - 1000);
			expect(ttl).toBeLessThanOrEqual(7 * DAY_MS + 1000);
		});

		it('audita advisor.member.invited só com ids', async () => {
			const result = await create();

			expect(audit.recorded).toHaveLength(1);
			const [event] = audit.recorded;
			expect(event.type).toBe(MEMBER_INVITED_EVENT);
			expect(event.subject).toBe(result.inviteId);
			expect(event.payload).toEqual({ orgId });
			expect(JSON.stringify(event)).not.toContain('fulano');
		});

		it('ADVISOR recebe ROLE_REQUIRED e nada é gravado', async () => {
			await expect(
				create('fulano@x.com', { userId: ADVISOR, orgId })
			).rejects.toBeInstanceOf(RoleRequiredError);
			expect(invites.size).toBe(0);
			expect(notifier.attempts).toHaveLength(0);
		});

		it('quem não é membro recebe 403', async () => {
			await expect(
				create('fulano@x.com', { userId: OTHER, orgId })
			).rejects.toBeInstanceOf(ForbiddenException);
		});

		it('e-mail inválido dá INVALID_EMAIL', async () => {
			await expect(create('sem-arroba')).rejects.toBeInstanceOf(
				InvalidInviteError
			);
			expect(await reasonOf(create(''))).toEqual({ reason: 'INVALID_EMAIL' });
			expect(invites.size).toBe(0);
		});

		it('conta do e-mail já membro da org dá 409 ALREADY_MEMBER', async () => {
			directory.set(ADVISOR, 'assessor@x.com');

			expect(await reasonOf(create('Assessor@X.com'))).toEqual({
				reason: 'ALREADY_MEMBER',
			});
			expect(invites.size).toBe(0);
			expect(notifier.attempts).toHaveLength(0);
			expect(audit.recorded).toHaveLength(0);
		});

		it('e-mail sem conta gera o mesmo convite de quem tem conta fora da org', async () => {
			directory.set(OTHER, 'outro@x.com');

			const withAccount = await create('outro@x.com');
			const withoutAccount = await create('ninguem@x.com');

			expect(Object.keys(withoutAccount).sort()).toEqual(
				Object.keys(withAccount).sort()
			);
			expect(invites.size).toBe(2);
			expect(notifier.sent.map((m) => m.to)).toEqual([
				'outro@x.com',
				'ninguem@x.com',
			]);
		});

		it('convite pendente para o e-mail (em outra caixa) dá 409 PENDING_INVITE', async () => {
			await create('fulano@x.com');

			expect(await reasonOf(create('FULANO@x.com'))).toEqual({
				reason: 'PENDING_INVITE',
			});
			expect(invites.size).toBe(1);
			expect(notifier.attempts).toHaveLength(1);
		});

		it('o mesmo e-mail pode ser convidado por outra organização', async () => {
			await create('fulano@x.com');
			await service.createInvite(
				{ userId: OTHER, orgId: otherOrgId },
				{ email: 'fulano@x.com' }
			);
			expect(invites.size).toBe(2);
		});

		it('pendente vencido vira EXPIRED e libera um convite novo', async () => {
			const first = await create();
			jest
				.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
				.setSystemTime(Date.now() + 8 * DAY_MS);
			try {
				const second = await create();

				expect(await statusOf(first.inviteId)).toBe(MemberInviteStatus.Expired);
				expect(await statusOf(second.inviteId)).toBe(
					MemberInviteStatus.Pending
				);
			} finally {
				jest.useRealTimers();
			}
		});

		it('corrida no índice único também dá PENDING_INVITE', async () => {
			jest
				.spyOn(invites, 'create')
				.mockRejectedValueOnce(new DuplicatePendingMemberInviteError());

			expect(await reasonOf(create())).toEqual({ reason: 'PENDING_INVITE' });
			expect(notifier.attempts).toHaveLength(0);
		});

		it('falha de auditoria apaga o convite, não envia e relança', async () => {
			audit.failWith = new Error('audit down');

			await expect(create()).rejects.toThrow('audit down');
			expect(invites.size).toBe(0);
			expect(notifier.attempts).toHaveLength(0);
		});

		it('falha do envio (ex.: sem ADVISOR_WEB_URL) apaga o convite e relança', async () => {
			notifier.failWith = new Error('ADVISOR_WEB_URL is not configured');

			await expect(create()).rejects.toThrow(
				'ADVISOR_WEB_URL is not configured'
			);
			expect(invites.size).toBe(0);
			// O e-mail fica livre para um convite novo depois de configurar.
			notifier.failWith = undefined;
			await expect(create()).resolves.toBeDefined();
		});

		it('nunca registra e-mail nem token em log', async () => {
			const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
				(level) => jest.spyOn(Logger.prototype, level).mockImplementation()
			);
			try {
				notifier.failWith = new Error('provider down');
				jest
					.spyOn(invites, 'deleteById')
					.mockRejectedValueOnce(new Error('db down'));
				await create().catch(() => undefined);

				const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
				expect(logged).not.toContain('fulano');
				for (const mail of notifier.attempts) {
					expect(logged).not.toContain(mail.token);
				}
			} finally {
				jest.restoreAllMocks();
			}
		});
	});

	describe('listPending', () => {
		it('lista os pendentes da org com e-mail mascarado', async () => {
			const { inviteId, expiresAt } = await create('fulano@x.com');
			await service.createInvite(
				{ userId: OTHER, orgId: otherOrgId },
				{ email: 'beltrano@x.com' }
			);

			expect(await service.listPending(adminCtx)).toEqual([
				{
					id: inviteId,
					emailMasked: 'fu***@x***.com',
					expiresAt,
					resendCount: 0,
					invitedBy: ADMIN,
				},
			]);
		});

		it('ADVISOR recebe ROLE_REQUIRED', async () => {
			await expect(
				service.listPending({ userId: ADVISOR, orgId })
			).rejects.toBeInstanceOf(RoleRequiredError);
		});
	});

	describe('resend', () => {
		it('gera token novo, invalida o antigo e envia', async () => {
			const { inviteId, token } = await invite();

			const result = await service.resend(adminCtx, inviteId);

			const stored = await invites.findById(orgId, inviteId);
			expect(stored?.resendCount).toBe(1);
			const fresh = notifier.sent[notifier.sent.length - 1];
			expect(fresh.token).not.toBe(token);
			expect(stored?.tokenHash).toBe(hashInviteToken(fresh.token));
			expect(result.expiresAt).toEqual(stored?.expiresAt);
			await expect(service.preview(INVITEE, token)).rejects.toBeInstanceOf(
				MemberInviteNotFoundError
			);
			await expect(
				service.preview(INVITEE, fresh.token)
			).resolves.toBeDefined();
		});

		it('depois de 3 reenvios dá 409 RESEND_LIMIT', async () => {
			const { inviteId } = await create();
			for (let i = 0; i < 3; i++) await service.resend(adminCtx, inviteId);

			expect(await reasonOf(service.resend(adminCtx, inviteId))).toEqual({
				reason: 'RESEND_LIMIT',
			});
			expect((await invites.findById(orgId, inviteId))?.resendCount).toBe(3);
		});

		it('convite de outra org dá 404', async () => {
			const { inviteId } = await create();
			await expect(
				service.resend({ userId: OTHER, orgId: otherOrgId }, inviteId)
			).rejects.toBeInstanceOf(NotFoundException);
		});

		it('convite cancelado dá 409 NOT_PENDING', async () => {
			const { inviteId } = await create();
			await service.cancel(adminCtx, inviteId);

			expect(await reasonOf(service.resend(adminCtx, inviteId))).toEqual({
				reason: 'NOT_PENDING',
			});
		});

		it('pendente vencido é reaberto com prazo novo, como no convite de cliente', async () => {
			const { inviteId } = await create();
			jest
				.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
				.setSystemTime(Date.now() + 8 * DAY_MS);
			try {
				const { expiresAt } = await service.resend(adminCtx, inviteId);

				expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
				expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Pending);
			} finally {
				jest.useRealTimers();
			}
		});

		it('ADVISOR recebe ROLE_REQUIRED', async () => {
			const { inviteId } = await create();
			await expect(
				service.resend({ userId: ADVISOR, orgId }, inviteId)
			).rejects.toBeInstanceOf(RoleRequiredError);
		});
	});

	describe('cancel', () => {
		it('PENDING vira CANCELLED e o token deixa de valer', async () => {
			const { inviteId, token } = await invite();

			await service.cancel(adminCtx, inviteId);

			expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Cancelled);
			await expect(service.accept(INVITEE, token)).rejects.toBeInstanceOf(
				MemberInviteNotFoundError
			);
		});

		it('cancelar de novo dá 409 NOT_PENDING', async () => {
			const { inviteId } = await create();
			await service.cancel(adminCtx, inviteId);
			expect(await reasonOf(service.cancel(adminCtx, inviteId))).toEqual({
				reason: 'NOT_PENDING',
			});
		});

		it('convite de outra org dá 404 e segue PENDING', async () => {
			const { inviteId } = await create();
			await expect(
				service.cancel({ userId: OTHER, orgId: otherOrgId }, inviteId)
			).rejects.toBeInstanceOf(NotFoundException);
			expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Pending);
		});

		it('ADVISOR recebe ROLE_REQUIRED', async () => {
			const { inviteId } = await create();
			await expect(
				service.cancel({ userId: ADVISOR, orgId }, inviteId)
			).rejects.toBeInstanceOf(RoleRequiredError);
		});
	});

	describe('preview', () => {
		it('mostra a organização, o e-mail mascarado e o prazo', async () => {
			const { token, expiresAt } = await invite();

			expect(await service.preview(INVITEE, token)).toEqual({
				organizationName: 'Escritório A',
				advisorType: AdvisorType.Assessor,
				invitedEmailMasked: 'fu***@x***.com',
				expiresAt,
			});
		});

		it('token inválido, vazio ou de outra conta dá o mesmo 404', async () => {
			const { token } = await invite();

			for (const [userId, t] of [
				[INVITEE, 'nao-existe'],
				[INVITEE, ''],
				[OTHER, token],
				['sem-conta', token],
			]) {
				await expect(service.preview(userId, t)).rejects.toBeInstanceOf(
					MemberInviteNotFoundError
				);
			}
		});

		it('token vencido dá 404 e o convite vira EXPIRED', async () => {
			const { inviteId, token } = await invite();
			jest
				.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
				.setSystemTime(Date.now() + 8 * DAY_MS);
			try {
				await expect(service.preview(INVITEE, token)).rejects.toBeInstanceOf(
					MemberInviteNotFoundError
				);
				expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Expired);
			} finally {
				jest.useRealTimers();
			}
		});
	});

	describe('accept', () => {
		it('cria a membership ADVISOR, gasta o convite, audita e confirma o e-mail', async () => {
			const { inviteId, token } = await invite();

			expect(await service.accept(INVITEE, token)).toEqual({
				orgId,
				role: OrgRole.Advisor,
			});

			expect(await memberships.findByUserAndOrg(INVITEE, orgId)).toMatchObject({
				role: OrgRole.Advisor,
			});
			expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Accepted);
			const joined = audit.recorded.find((e) => e.type === MEMBER_JOINED_EVENT);
			expect(joined).toMatchObject({
				subject: inviteId,
				payload: { orgId },
			});
			expect(JSON.stringify(joined)).not.toContain('fulano');
			expect(identity.verifiedCalls).toEqual([[INVITEE, 'fulano@x.com']]);
		});

		it('o token é de uso único', async () => {
			const { token } = await invite();
			await service.accept(INVITEE, token);

			await expect(service.accept(INVITEE, token)).rejects.toBeInstanceOf(
				MemberInviteNotFoundError
			);
		});

		it('conta criada depois com o e-mail em outra caixa aceita o convite', async () => {
			const { token } = await invite('fulano@x.com');
			identity.set('late-1', { email: 'Fulano@X.com', emailVerified: false });

			await expect(service.accept('late-1', token)).resolves.toEqual({
				orgId,
				role: OrgRole.Advisor,
			});
			expect(identity.verifiedCalls).toEqual([['late-1', 'Fulano@X.com']]);
		});

		it('aceite de outra conta dá 404 e o convite segue PENDING', async () => {
			const { inviteId, token } = await invite();

			await expect(service.accept(OTHER, token)).rejects.toBeInstanceOf(
				MemberInviteNotFoundError
			);
			expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Pending);
			expect(await memberships.findByUserAndOrg(OTHER, orgId)).toBeNull();
		});

		it('quem já é membro recebe 409 ALREADY_MEMBER e o convite segue PENDING', async () => {
			const { inviteId, token } = await invite();
			await memberships.create({
				userId: INVITEE,
				orgId,
				role: OrgRole.OrgAdmin,
			});

			expect(await reasonOf(service.accept(INVITEE, token))).toEqual({
				reason: 'ALREADY_MEMBER',
			});
			expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Pending);
		});

		it('membership duplicada na corrida devolve o convite a PENDING com ALREADY_MEMBER', async () => {
			const { inviteId, token } = await invite();
			jest
				.spyOn(memberships, 'create')
				.mockRejectedValueOnce(new DuplicateMembershipError());

			expect(await reasonOf(service.accept(INVITEE, token))).toEqual({
				reason: 'ALREADY_MEMBER',
			});
			expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Pending);
			expect(audit.recorded.some((e) => e.type === MEMBER_JOINED_EVENT)).toBe(
				false
			);
		});

		it('dois aceites simultâneos criam uma só membership', async () => {
			const { token } = await invite();

			const results = await Promise.allSettled([
				service.accept(INVITEE, token),
				service.accept(INVITEE, token),
			]);

			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			const members = await memberships.listByOrg(orgId);
			expect(members.filter((m) => m.userId === INVITEE)).toHaveLength(1);
		});

		it('falha de auditoria desfaz a membership, devolve o convite a PENDING e relança', async () => {
			const { inviteId, token } = await invite();
			audit.failWith = new Error('audit down');

			await expect(service.accept(INVITEE, token)).rejects.toThrow(
				'audit down'
			);
			expect(await memberships.findByUserAndOrg(INVITEE, orgId)).toBeNull();
			expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Pending);
			expect(identity.verifiedCalls).toHaveLength(0);
		});

		it('falha ao confirmar o e-mail só é logada (ids) e o aceite vale', async () => {
			const { token } = await invite();
			identity.failVerifyWith = new Error('db down');
			const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
			try {
				await expect(service.accept(INVITEE, token)).resolves.toBeDefined();
				expect(
					await memberships.findByUserAndOrg(INVITEE, orgId)
				).not.toBeNull();
				const logged = JSON.stringify(error.mock.calls);
				expect(logged).toContain(INVITEE);
				expect(logged).not.toContain('fulano');
				expect(logged).not.toContain(token);
			} finally {
				error.mockRestore();
			}
		});

		it('token vencido dá 404 e o convite vira EXPIRED', async () => {
			const { inviteId, token } = await invite();
			jest
				.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
				.setSystemTime(Date.now() + 8 * DAY_MS);
			try {
				await expect(service.accept(INVITEE, token)).rejects.toBeInstanceOf(
					MemberInviteNotFoundError
				);
				expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Expired);
			} finally {
				jest.useRealTimers();
			}
		});
	});

	describe('decline', () => {
		it('PENDING vira DECLINED e audita advisor.member.declined', async () => {
			const { inviteId, token } = await invite();

			await service.decline(INVITEE, token);

			expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Declined);
			const declined = audit.recorded.find(
				(e) => e.type === MEMBER_DECLINED_EVENT
			);
			expect(declined).toMatchObject({ subject: inviteId, payload: { orgId } });
			await expect(service.accept(INVITEE, token)).rejects.toBeInstanceOf(
				MemberInviteNotFoundError
			);
		});

		it('recusa de outra conta dá 404 e o convite segue PENDING', async () => {
			const { inviteId, token } = await invite();
			await expect(service.decline(OTHER, token)).rejects.toBeInstanceOf(
				MemberInviteNotFoundError
			);
			expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Pending);
		});

		it('falha de auditoria devolve o convite a PENDING e relança', async () => {
			const { inviteId, token } = await invite();
			audit.failWith = new Error('audit down');

			await expect(service.decline(INVITEE, token)).rejects.toThrow(
				'audit down'
			);
			expect(await statusOf(inviteId)).toBe(MemberInviteStatus.Pending);
		});
	});
});
