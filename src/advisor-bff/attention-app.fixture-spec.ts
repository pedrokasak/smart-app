import { INestApplication, Type, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import {
	ADVISOR_ALERT_SETTINGS_STORE,
	ADVISOR_ALERT_STORE,
	ADVISOR_ASSIGNMENT_STORE,
	ADVISOR_CLIENT_CONTACT_STORE,
	ADVISOR_CLIENT_PROFILE_STORE,
	ADVISOR_CLIENT_SNAPSHOT_STORE,
	ADVISOR_INVITE_STORE,
	ADVISOR_MEMBERSHIP_STORE,
	ADVISOR_RELATIONSHIP_STORE,
	ADVISOR_WEALTH_DAILY_STORE,
} from 'src/advisor/application/advisor.tokens';
import { AlertSettingsService } from 'src/advisor/application/attention/alert-settings.service';
import { AlertService } from 'src/advisor/application/attention/alert.service';
import { DashboardService } from 'src/advisor/application/attention/dashboard.service';
import { AuthorizationService } from 'src/advisor/application/authorization.service';
import {
	InMemoryAlertSettingsStore,
	InMemoryAlertStore,
	InMemoryAssignmentStore,
	InMemoryClientContactStore,
	InMemoryClientProfileStore,
	InMemoryClientSnapshotStore,
	InMemoryInviteStore,
	InMemoryMembershipStore,
	InMemoryRelationshipStore,
	InMemoryWealthDailyStore,
} from 'src/advisor/application/in-memory-stores.fixture';
import { MembershipService } from 'src/advisor/application/membership.service';
import { OrganizationService } from 'src/advisor/application/organization.service';
import { PortalAccessService } from 'src/advisor/application/portal-access.service';
import type { NewAlert } from 'src/advisor/application/ports/alert.store.port';
import { Alert, conditionKeyOf } from 'src/advisor/domain/attention.entities';
import {
	AlertPriority,
	AlertRule,
	AlertStatus,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
	SnapshotSource,
} from 'src/advisor/domain/enums';
import { OrgContextGuard } from 'src/advisor/interface/org-context.guard';
import { AUDIT_TRAIL } from 'src/audit/application/audit-trail.port';
import { jwtSecret } from 'src/env';
import { TokenBlacklistService } from 'src/token-blacklist/token-blacklist.service';
import { OrgPortalGuard } from './org-portal.guard';

/**
 * Só para os specs dos controllers do motor de atenção. O nome termina em
 * `-spec.ts` de propósito: o exclude do `tsconfig.build.json` o deixa de fora e o jest
 * (`.spec.ts`) não o roda como suíte.
 */
export const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
// Ids de usuário no formato do projeto (ObjectId).
export const ADMIN = '64b000000000000000000001';
export const ADVISOR = '64b000000000000000000002';
export const ADMIN_B = '64b000000000000000000003';

export interface AttentionApp {
	app: INestApplication;
	alerts: InMemoryAlertStore;
	settings: InMemoryAlertSettingsStore;
	snapshots: InMemoryClientSnapshotStore;
	wealth: InMemoryWealthDailyStore;
	contacts: InMemoryClientContactStore;
	invites: InMemoryInviteStore;
	assignments: InMemoryAssignmentStore;
	record: jest.Mock;
	http: () => ReturnType<typeof request>;
	/** Headers com JWT e, se dado, `x-org-id`. */
	as: (userId: string, orgId?: string) => Record<string, string>;
	/** Cliente ADVISOR_CREATED com vínculo ACTIVE; devolve ids. */
	client: (
		orgId?: string
	) => Promise<{ clientProfileId: string; relationshipId: string }>;
	/** Grava um alerta de regra (POSITION_DROP por padrão). */
	seedAlert: (
		clientProfileId: string,
		over?: Partial<NewAlert>
	) => Promise<Alert>;
}

/**
 * App Nest com os serviços reais do motor de atenção sobre os stores em
 * memória, os guards do BFF e o mesmo ValidationPipe do `main.ts`. ORG_A tem
 * ADMIN (ORG_ADMIN) e ADVISOR; ORG_B tem ADMIN_B.
 */
export async function buildAttentionApp(
	controllers: Type<unknown>[],
	extraProviders: any[] = []
): Promise<AttentionApp> {
	const memberships = new InMemoryMembershipStore();
	const assignments = new InMemoryAssignmentStore();
	const relationships = new InMemoryRelationshipStore(assignments);
	const profiles = new InMemoryClientProfileStore();
	const alerts = new InMemoryAlertStore();
	const settings = new InMemoryAlertSettingsStore();
	const snapshots = new InMemoryClientSnapshotStore();
	const wealth = new InMemoryWealthDailyStore();
	const contacts = new InMemoryClientContactStore();
	const invites = new InMemoryInviteStore();
	const record = jest.fn();
	await memberships.create({
		userId: ADMIN,
		orgId: ORG_A,
		role: OrgRole.OrgAdmin,
	});
	await memberships.create({
		userId: ADVISOR,
		orgId: ORG_A,
		role: OrgRole.Advisor,
	});
	await memberships.create({
		userId: ADMIN_B,
		orgId: ORG_B,
		role: OrgRole.OrgAdmin,
	});

	const moduleRef = await Test.createTestingModule({
		imports: [JwtModule.register({ secret: jwtSecret })],
		controllers,
		providers: [
			OrgContextGuard,
			OrgPortalGuard,
			MembershipService,
			AuthorizationService,
			AlertService,
			AlertSettingsService,
			DashboardService,
			{ provide: ADVISOR_MEMBERSHIP_STORE, useValue: memberships },
			{ provide: ADVISOR_ASSIGNMENT_STORE, useValue: assignments },
			{ provide: ADVISOR_RELATIONSHIP_STORE, useValue: relationships },
			{ provide: ADVISOR_CLIENT_PROFILE_STORE, useValue: profiles },
			{ provide: ADVISOR_INVITE_STORE, useValue: invites },
			{ provide: ADVISOR_ALERT_STORE, useValue: alerts },
			{ provide: ADVISOR_ALERT_SETTINGS_STORE, useValue: settings },
			{ provide: ADVISOR_CLIENT_SNAPSHOT_STORE, useValue: snapshots },
			{ provide: ADVISOR_WEALTH_DAILY_STORE, useValue: wealth },
			{ provide: ADVISOR_CLIENT_CONTACT_STORE, useValue: contacts },
			{ provide: AUDIT_TRAIL, useValue: { record } },
			{
				provide: PortalAccessService,
				useValue: { hasAccess: jest.fn().mockResolvedValue(true) },
			},
			{
				provide: OrganizationService,
				useValue: {
					ownerOf: async (orgId: string) =>
						({ [ORG_A]: ADMIN, [ORG_B]: ADMIN_B })[orgId] ?? null,
				},
			},
			{
				provide: TokenBlacklistService,
				useValue: { isBlacklisted: jest.fn().mockResolvedValue(false) },
			},
			...extraProviders,
		],
	}).compile();

	const app = moduleRef.createNestApplication();
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
		})
	);
	await app.init();
	const jwt = moduleRef.get(JwtService);

	const as = (userId: string, orgId?: string) => {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${jwt.sign({ userId, type: 'access', role: 'user' })}`,
		};
		if (orgId) headers['x-org-id'] = orgId;
		return headers;
	};

	const client = async (orgId = ORG_A) => {
		const profile = profiles.seed({
			id: randomUUID(),
			orgId,
			name: 'Cliente',
			origin: ProfileOrigin.AdvisorCreated,
		});
		const relationship = await relationships.create({
			orgId,
			clientProfileId: profile.id,
			status: RelationshipStatus.Active,
		});
		return { clientProfileId: profile.id, relationshipId: relationship.id };
	};

	const seedAlert = async (
		clientProfileId: string,
		over: Partial<NewAlert> = {}
	): Promise<Alert> => {
		const base = {
			rule: AlertRule.PositionDrop,
			source: SnapshotSource.AdvisorLedger,
			key: 'PETR4',
			...over,
		};
		const [stored] = await alerts.insertMany([
			{
				band: 1,
				priority: AlertPriority.P1,
				messageKey: 'advisor.alert.position_drop',
				params: { symbol: 'PETR4', dropPct: 12.5 },
				evidence: { lastClose: 3010 },
				dataAsOf: '2025-06-16',
				provenance: null,
				lowConfidence: false,
				orgId: ORG_A,
				clientProfileId,
				conditionKey: conditionKeyOf(base),
				status: AlertStatus.Open,
				...base,
			} as NewAlert,
		]);
		return stored;
	};

	return {
		app,
		alerts,
		settings,
		snapshots,
		wealth,
		contacts,
		invites,
		assignments,
		record,
		http: () => request(app.getHttpServer()),
		as,
		client,
		seedAlert,
	};
}
