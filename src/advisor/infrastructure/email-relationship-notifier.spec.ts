import { Logger } from '@nestjs/common';
import { EmailService } from 'src/notifications/email/email.service';
import {
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryPortalAccountDirectory,
} from '../application/in-memory-stores.fixture';
import { AdvisorType, OrgRole, ProfileOrigin } from '../domain/enums';
import { EmailRelationshipNotifier } from './email-relationship-notifier';

describe('EmailRelationshipNotifier', () => {
	let assignments: InMemoryAssignmentStore;
	let memberships: InMemoryMembershipStore;
	let profiles: InMemoryClientProfileStore;
	let orgs: InMemoryOrganizationStore;
	let accounts: InMemoryPortalAccountDirectory;
	let email: { sendAdvisorRelationshipUpdateEmail: jest.Mock };
	let orgId: string;
	let clientProfileId: string;

	const build = (webUrl: string | null = 'https://assessor.example.com/') =>
		new EmailRelationshipNotifier(
			email as unknown as EmailService,
			assignments,
			memberships,
			profiles,
			orgs,
			accounts,
			webUrl
		);

	const recipients = () =>
		email.sendAdvisorRelationshipUpdateEmail.mock.calls
			.map(([params]) => params.to as string)
			.sort();

	beforeEach(async () => {
		assignments = new InMemoryAssignmentStore();
		memberships = new InMemoryMembershipStore();
		profiles = new InMemoryClientProfileStore();
		orgs = new InMemoryOrganizationStore();
		accounts = new InMemoryPortalAccountDirectory();
		email = {
			sendAdvisorRelationshipUpdateEmail: jest
				.fn()
				.mockResolvedValue(undefined),
		};
		const org = await orgs.create({
			name: 'Acme Assessoria',
			advisorType: AdvisorType.Assessor,
		});
		orgId = org.id;
		const profile = await profiles.create({
			orgId,
			name: 'Joao Carlos Silva',
			origin: ProfileOrigin.ClientCreated,
		});
		clientProfileId = profile.id;
		for (const [userId, role] of [
			['adv-1', OrgRole.Advisor],
			['adv-2', OrgRole.Advisor],
			['adv-3', OrgRole.Advisor],
			['admin-1', OrgRole.OrgAdmin],
			['admin-2', OrgRole.OrgAdmin],
		] as const) {
			await memberships.create({ userId, orgId, role });
			accounts.set(userId, `${userId}@example.com`, userId);
		}
		await assignments.assign(orgId, clientProfileId, 'adv-1', 'admin-1');
		await assignments.assign(orgId, clientProfileId, 'adv-2', 'admin-1');
		// Atribuído E admin: não pode receber duas vezes.
		await assignments.assign(orgId, clientProfileId, 'admin-1', 'admin-1');
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('avisa os assessores atribuídos e os ORG_ADMIN, sem repetir ninguém', async () => {
		await build().notify({ orgId, clientProfileId, kind: 'ACCEPTED' });

		expect(recipients()).toEqual([
			'admin-1@example.com',
			'admin-2@example.com',
			'adv-1@example.com',
			'adv-2@example.com',
		]);
	});

	it('não avisa assessor não atribuído a esse cliente nem de outro cliente', async () => {
		const other = await profiles.create({
			orgId,
			name: 'Outra',
			origin: ProfileOrigin.ClientCreated,
		});
		await assignments.assign(orgId, other.id, 'adv-3', 'admin-1');

		await build().notify({ orgId, clientProfileId, kind: 'REVOKED' });

		expect(recipients()).not.toContain('adv-3@example.com');
	});

	it('manda só organização, primeiro nome, tipo e o link /clientes', async () => {
		await build().notify({ orgId, clientProfileId, kind: 'DECLINED' });

		const [params] = email.sendAdvisorRelationshipUpdateEmail.mock.calls[0];
		expect(params).toEqual({
			to: expect.any(String),
			kind: 'DECLINED',
			orgName: 'Acme Assessoria',
			clientFirstName: 'Joao',
			portalLink: 'https://assessor.example.com/clientes',
		});
	});

	it('ignora quem não tem conta com e-mail e não falha por isso', async () => {
		const noAccount = await profiles.create({
			orgId,
			name: 'X',
			origin: ProfileOrigin.ClientCreated,
		});
		await assignments.assign(orgId, noAccount.id, 'ghost', 'admin-1');

		await build().notify({
			orgId,
			clientProfileId: noAccount.id,
			kind: 'ACCEPTED',
		});

		expect(recipients()).toEqual([
			'admin-1@example.com',
			'admin-2@example.com',
		]);
	});

	it('não envia nada se a organização ou o perfil sumiram', async () => {
		await build().notify({ orgId, clientProfileId: 'nope', kind: 'ACCEPTED' });
		await build().notify({ orgId: 'nope', clientProfileId, kind: 'ACCEPTED' });

		expect(email.sendAdvisorRelationshipUpdateEmail).not.toHaveBeenCalled();
	});

	it('um envio que falha não impede os outros e propaga o erro depois', async () => {
		email.sendAdvisorRelationshipUpdateEmail.mockImplementation(
			async ({ to }: { to: string }) => {
				if (to === 'adv-1@example.com') throw new Error('provider down');
			}
		);

		await expect(
			build().notify({ orgId, clientProfileId, kind: 'ACCEPTED' })
		).rejects.toThrow('provider down');

		expect(email.sendAdvisorRelationshipUpdateEmail).toHaveBeenCalledTimes(4);
	});

	it.each([null, '', 'assessor.example.com', 'javascript:alert(1)'])(
		'sem ADVISOR_WEB_URL válido (%p) lança e não envia nada',
		async (webUrl) => {
			await expect(
				build(webUrl).notify({ orgId, clientProfileId, kind: 'ACCEPTED' })
			).rejects.toThrow('ADVISOR_WEB_URL is not configured');

			expect(email.sendAdvisorRelationshipUpdateEmail).not.toHaveBeenCalled();
		}
	);

	it('nunca registra e-mail nem nome do cliente', async () => {
		const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
			(level) => jest.spyOn(Logger.prototype, level).mockImplementation()
		);
		email.sendAdvisorRelationshipUpdateEmail.mockRejectedValue(
			new Error('provider down')
		);

		await build()
			.notify({ orgId, clientProfileId, kind: 'ACCEPTED' })
			.catch(() => undefined);

		const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
		expect(logged).not.toContain('@example.com');
		expect(logged).not.toContain('Joao');
	});
});
