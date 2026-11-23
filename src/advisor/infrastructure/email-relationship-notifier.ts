import { Inject, Injectable } from '@nestjs/common';
import { EmailService } from 'src/notifications/email/email.service';
import {
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_ORG_STORE,
} from '../application/advisor.tokens';
import type { AssignmentStorePort } from '../application/ports/assignment.store.port';
import type { ClientProfileStorePort } from '../application/ports/client-profile.store.port';
import type { MembershipStorePort } from '../application/ports/membership.store.port';
import type { OrganizationStorePort } from '../application/ports/organization.store.port';
import { ADVISOR_PORTAL_ACCOUNT_DIRECTORY } from '../application/ports/portal-account-directory.port';
import type { PortalAccountDirectoryPort } from '../application/ports/portal-account-directory.port';
import type {
	RelationshipNotifierPort,
	RelationshipUpdateInput,
} from '../application/ports/relationship-notifier.port';
import { OrgRole } from '../domain/enums';
import { ADVISOR_WEB_URL } from './email-member-invite-notifier.adapter';

/**
 * Avisa por e-mail quem enxerga o cliente (os assessores atribuídos e todos
 * os `ORG_ADMIN`, sem repetir ninguém) de que ele aceitou, recusou ou
 * revogou. O e-mail só traz o nome do escritório e o primeiro nome do
 * cliente. Cada envio é independente: um que falha não impede os outros, e o
 * primeiro erro é lançado no fim. Não registra nada: e-mail e nome nunca vão
 * para log.
 */
@Injectable()
export class EmailRelationshipNotifier implements RelationshipNotifierPort {
	constructor(
		private readonly email: EmailService,
		@Inject(ADVISOR_ASSIGNMENT_STORE)
		private readonly assignments: AssignmentStorePort,
		@Inject(ADVISOR_MEMBERSHIP_STORE)
		private readonly memberships: MembershipStorePort,
		@Inject(ADVISOR_CLIENT_PROFILE_STORE)
		private readonly profiles: ClientProfileStorePort,
		@Inject(ADVISOR_ORG_STORE) private readonly orgs: OrganizationStorePort,
		@Inject(ADVISOR_PORTAL_ACCOUNT_DIRECTORY)
		private readonly accounts: PortalAccountDirectoryPort,
		@Inject(ADVISOR_WEB_URL) private readonly webUrl: string | null
	) {}

	async notify(input: RelationshipUpdateInput): Promise<void> {
		const portalLink = `${this.portalBaseUrl().replace(/\/+$/, '')}/clientes`;
		const [org, profile] = await Promise.all([
			this.orgs.findById(input.orgId),
			this.profiles.findById(input.clientProfileId),
		]);
		if (!org || !profile || profile.orgId !== input.orgId) return;

		const addresses = await this.accounts.findEmails(
			await this.recipientIds(input)
		);
		const clientFirstName = firstNameOf(profile.name);
		const results = await Promise.allSettled(
			[...addresses.values()].map((to) =>
				this.email.sendAdvisorRelationshipUpdateEmail({
					to,
					kind: input.kind,
					orgName: org.name,
					clientFirstName,
					portalLink,
				})
			)
		);
		const failed = results.find(
			(r): r is PromiseRejectedResult => r.status === 'rejected'
		);
		if (failed) throw failed.reason;
	}

	private async recipientIds(
		input: RelationshipUpdateInput
	): Promise<string[]> {
		const [assigned, members] = await Promise.all([
			this.assignments.listByClient(input.orgId, input.clientProfileId),
			this.memberships.listByOrg(input.orgId),
		]);
		return [
			...new Set([
				...assigned.map((a) => a.userId),
				...members
					.filter((m) => m.role === OrgRole.OrgAdmin)
					.map((m) => m.userId),
			]),
		];
	}

	private portalBaseUrl(): string {
		if (this.webUrl && /^https?:$/.test(protocolOf(this.webUrl))) {
			return this.webUrl;
		}
		throw new Error('ADVISOR_WEB_URL is not configured');
	}
}

/** Primeira palavra do nome; vazio se não houver. */
function firstNameOf(name: string): string {
	return (
		String(name ?? '')
			.trim()
			.split(/\s+/)[0] ?? ''
	);
}

function protocolOf(url: string): string {
	try {
		return new URL(url).protocol;
	} catch {
		return '';
	}
}
