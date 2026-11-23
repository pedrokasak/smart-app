import { randomUUID } from 'crypto';
import { Connection, Model, createConnection } from 'mongoose';
import {
	describeAdvisorAttentionStoreContract,
	describeAdvisorConsentStoreContract,
	describeAdvisorPortalGrantStoreContract,
	describeAdvisorPortfolioStoreContract,
	describeAdvisorStoreContract,
	describeAdvisorTeamStoreContract,
	AdvisorAttentionStores,
	AdvisorTeamStores,
} from '../application/store-contract.fixture';
import {
	DuplicateMembershipError,
	DuplicateOrganizationOwnerError,
	DuplicatePendingMemberInviteError,
} from '../application/ports/store-errors';
import {
	AdvisorType,
	AlertPriority,
	AlertRule,
	AlertStatus,
	ConsentStatus,
	InviteStatus,
	MemberInviteStatus,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
	SnapshotSource,
} from '../domain/enums';
import {
	ADVISOR_ALERT_MODEL,
	ADVISOR_ALERT_SETTINGS_MODEL,
	ADVISOR_CLIENT_CONTACT_MODEL,
	ADVISOR_CLIENT_SNAPSHOT_MODEL,
	ADVISOR_WEALTH_DAILY_MODEL,
	AdvisorAlertDoc,
	AdvisorAlertSettingsDoc,
	AdvisorClientContactDoc,
	AdvisorClientSnapshotDoc,
	AdvisorWealthDailyDoc,
	advisorAttentionSchemas,
	WEALTH_DAILY_TTL_INDEX,
	WEALTH_DAILY_TTL_SECONDS,
} from './advisor-attention.models';
import {
	ADVISOR_CLIENT_INVITE_MODEL,
	ADVISOR_CONSENT_MODEL,
	AdvisorClientInviteDoc,
	AdvisorConsentDoc,
	advisorConsentSchemas,
} from './advisor-consent.models';
import {
	ADVISOR_CLIENT_PROFILE_MODEL,
	ADVISOR_MEMBERSHIP_MODEL,
	ADVISOR_ORGANIZATION_MODEL,
	ADVISOR_RELATIONSHIP_MODEL,
	AdvisorClientProfileDoc,
	AdvisorMembershipDoc,
	AdvisorOrganizationDoc,
	AdvisorRelationshipDoc,
	advisorSchemas,
} from './advisor.models';
import {
	ADVISOR_ALLOCATION_TARGET_MODEL,
	ADVISOR_IMPORT_BATCH_MODEL,
	ADVISOR_TRANSACTION_MODEL,
	AdvisorAllocationTargetDoc,
	AdvisorImportBatchDoc,
	AdvisorTransactionDoc,
	advisorPortfolioSchemas,
} from './advisor-portfolio.models';
import {
	ADVISOR_PORTAL_GRANT_MODEL,
	AdvisorPortalGrantDoc,
	advisorPortalGrantSchema,
} from './advisor-portal-grant.models';
import {
	ADVISOR_CLIENT_ASSIGNMENT_MODEL,
	ADVISOR_MEMBER_INVITE_MODEL,
	AdvisorClientAssignmentDoc,
	AdvisorMemberInviteDoc,
	advisorTeamSchemas,
} from './advisor-team.models';
import { MongoAssignmentStore } from './mongo-assignment.store';
import { MongoMemberInviteStore } from './mongo-member-invite.store';
import { MongoAlertSettingsStore } from './mongo-alert-settings.store';
import { MongoAlertStore } from './mongo-alert.store';
import { MongoAllocationTargetStore } from './mongo-allocation-target.store';
import { MongoClientContactStore } from './mongo-client-contact.store';
import { MongoClientSnapshotStore } from './mongo-client-snapshot.store';
import { MongoWealthDailyStore } from './mongo-wealth-daily.store';
import { MongoPortalGrantStore } from './mongo-portal-grant.store';
import { MongoTransactionStore } from './mongo-transaction.store';
import { assertDisposableDb, buildTestDbName } from './mongo-test-database';
import { MongoClientProfileStore } from './mongo-client-profile.store';
import { MongoConsentStore } from './mongo-consent.store';
import { MongoInviteStore } from './mongo-invite.store';
import { MongoMembershipStore } from './mongo-membership.store';
import { MongoOrganizationStore } from './mongo-organization.store';
import { MongoRelationshipStore } from './mongo-relationship.store';

/**
 * Roda a suíte de contrato dos ports contra o Mongo real. Só executa com
 * `MONGO_TEST_URI` apontando para um Mongo descartável (nunca o do `.env`).
 * Conecta num banco `advisor_contract_<uuid>` gerado por execução, ignorando o
 * banco que a URI nomeia, e só derruba esse banco (com guarda de prefixo).
 */
const TEST_URI = process.env.MONGO_TEST_URI;
const describeMongo = TEST_URI ? describe : describe.skip;

describeMongo('advisor mongo stores', () => {
	let conn: Connection;
	let stores: {
		orgs: MongoOrganizationStore;
		memberships: MongoMembershipStore;
		relationships: MongoRelationshipStore;
		profiles: MongoClientProfileStore;
	};
	let consentStores: {
		invites: MongoInviteStore;
		consents: MongoConsentStore;
	};
	let portfolioStores: {
		transactions: MongoTransactionStore;
		targets: MongoAllocationTargetStore;
	};
	let attentionStores: AdvisorAttentionStores;
	let alertModel: Model<AdvisorAlertDoc>;
	let wealthModel: Model<AdvisorWealthDailyDoc>;
	let settingsModel: Model<AdvisorAlertSettingsDoc>;
	let snapshotModel: Model<AdvisorClientSnapshotDoc>;
	let contactModel: Model<AdvisorClientContactDoc>;
	let portalGrants: MongoPortalGrantStore;
	let teamStores: AdvisorTeamStores;

	beforeAll(async () => {
		conn = await createConnection(TEST_URI as string, {
			dbName: buildTestDbName(),
		}).asPromise();
		assertDisposableDb(conn.name);
		const orgModel = conn.model<AdvisorOrganizationDoc>(
			ADVISOR_ORGANIZATION_MODEL,
			advisorSchemas.organization
		);
		const membershipModel = conn.model<AdvisorMembershipDoc>(
			ADVISOR_MEMBERSHIP_MODEL,
			advisorSchemas.membership
		);
		const relationshipModel = conn.model<AdvisorRelationshipDoc>(
			ADVISOR_RELATIONSHIP_MODEL,
			advisorSchemas.relationship
		);
		const profileModel = conn.model<AdvisorClientProfileDoc>(
			ADVISOR_CLIENT_PROFILE_MODEL,
			advisorSchemas.clientProfile
		);
		const transactionModel = conn.model<AdvisorTransactionDoc>(
			ADVISOR_TRANSACTION_MODEL,
			advisorPortfolioSchemas.transaction
		);
		const importBatchModel = conn.model<AdvisorImportBatchDoc>(
			ADVISOR_IMPORT_BATCH_MODEL,
			advisorPortfolioSchemas.importBatch
		);
		const targetModel = conn.model<AdvisorAllocationTargetDoc>(
			ADVISOR_ALLOCATION_TARGET_MODEL,
			advisorPortfolioSchemas.allocationTarget
		);
		const inviteModel = conn.model<AdvisorClientInviteDoc>(
			ADVISOR_CLIENT_INVITE_MODEL,
			advisorConsentSchemas.clientInvite
		);
		const consentModel = conn.model<AdvisorConsentDoc>(
			ADVISOR_CONSENT_MODEL,
			advisorConsentSchemas.consent
		);
		const portalGrantModel = conn.model<AdvisorPortalGrantDoc>(
			ADVISOR_PORTAL_GRANT_MODEL,
			advisorPortalGrantSchema
		);
		const assignmentModel = conn.model<AdvisorClientAssignmentDoc>(
			ADVISOR_CLIENT_ASSIGNMENT_MODEL,
			advisorTeamSchemas.assignment
		);
		const memberInviteModel = conn.model<AdvisorMemberInviteDoc>(
			ADVISOR_MEMBER_INVITE_MODEL,
			advisorTeamSchemas.memberInvite
		);
		snapshotModel = conn.model<AdvisorClientSnapshotDoc>(
			ADVISOR_CLIENT_SNAPSHOT_MODEL,
			advisorAttentionSchemas.clientSnapshot
		);
		wealthModel = conn.model<AdvisorWealthDailyDoc>(
			ADVISOR_WEALTH_DAILY_MODEL,
			advisorAttentionSchemas.wealthDaily
		);
		alertModel = conn.model<AdvisorAlertDoc>(
			ADVISOR_ALERT_MODEL,
			advisorAttentionSchemas.alert
		);
		settingsModel = conn.model<AdvisorAlertSettingsDoc>(
			ADVISOR_ALERT_SETTINGS_MODEL,
			advisorAttentionSchemas.alertSettings
		);
		contactModel = conn.model<AdvisorClientContactDoc>(
			ADVISOR_CLIENT_CONTACT_MODEL,
			advisorAttentionSchemas.clientContact
		);
		// `syncIndexes` garante que os índices únicos existem antes dos testes.
		await Promise.all(
			[
				orgModel,
				membershipModel,
				relationshipModel,
				profileModel,
				transactionModel,
				importBatchModel,
				targetModel,
				inviteModel,
				consentModel,
				portalGrantModel,
				assignmentModel,
				memberInviteModel,
				snapshotModel,
				wealthModel,
				alertModel,
				settingsModel,
				contactModel,
			].map((m) => m.syncIndexes())
		);
		attentionStores = {
			snapshots: new MongoClientSnapshotStore(snapshotModel),
			wealth: new MongoWealthDailyStore(wealthModel),
			alerts: new MongoAlertStore(alertModel),
			settings: new MongoAlertSettingsStore(settingsModel),
			contacts: new MongoClientContactStore(contactModel),
		};
		portalGrants = new MongoPortalGrantStore(portalGrantModel);
		consentStores = {
			invites: new MongoInviteStore(inviteModel),
			consents: new MongoConsentStore(consentModel),
		};
		portfolioStores = {
			transactions: new MongoTransactionStore(
				transactionModel,
				importBatchModel
			),
			targets: new MongoAllocationTargetStore(targetModel),
		};
		stores = {
			orgs: new MongoOrganizationStore(orgModel),
			memberships: new MongoMembershipStore(membershipModel),
			relationships: new MongoRelationshipStore(relationshipModel),
			profiles: new MongoClientProfileStore(profileModel),
		};
		teamStores = {
			assignments: new MongoAssignmentStore(assignmentModel),
			memberInvites: new MongoMemberInviteStore(memberInviteModel),
			memberships: stores.memberships,
			relationships: stores.relationships,
			profiles: stores.profiles,
		};
	});

	afterAll(async () => {
		if (conn) {
			assertDisposableDb(conn.name);
			await conn.dropDatabase();
			await conn.close();
		}
	});

	describeAdvisorStoreContract('mongo', () => stores);
	describeAdvisorPortfolioStoreContract('mongo', () => portfolioStores);
	describeAdvisorConsentStoreContract('mongo', () => consentStores);
	describeAdvisorPortalGrantStoreContract('mongo', () => portalGrants);
	describeAdvisorTeamStoreContract('mongo', () => teamStores);
	describeAdvisorAttentionStoreContract('mongo', () => attentionStores);

	describe('indexes', () => {
		it('rejects a duplicate membership for the same user and org', async () => {
			const userId = randomUUID();
			const orgId = randomUUID();
			await stores.memberships.create({ userId, orgId, role: OrgRole.Advisor });
			await expect(
				stores.memberships.create({ userId, orgId, role: OrgRole.OrgAdmin })
			).rejects.toBeInstanceOf(DuplicateMembershipError);
		});

		it('rejects a second org for the same owner with the typed error, not E11000', async () => {
			const ownerUserId = randomUUID();
			await stores.orgs.create({
				name: 'One',
				advisorType: AdvisorType.Assessor,
				ownerUserId,
			});
			await expect(
				stores.orgs.create({
					name: 'Two',
					advisorType: AdvisorType.Assessor,
					ownerUserId,
				})
			).rejects.toBeInstanceOf(DuplicateOrganizationOwnerError);
		});

		it('returns the existing ACTIVE relationship instead of creating a second', async () => {
			const orgId = randomUUID();
			const clientProfileId = randomUUID();
			const first = await stores.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Active,
			});
			const second = await stores.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Active,
			});
			expect(second).toEqual(first);
		});

		it('allows a new ACTIVE relationship after the previous one was revoked', async () => {
			const orgId = randomUUID();
			const clientProfileId = randomUUID();
			const first = await stores.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Active,
			});
			await stores.relationships.save({
				...first,
				status: RelationshipStatus.Revoked,
			});
			const second = await stores.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Active,
			});
			expect(second.id).not.toBe(first.id);
			expect(
				await stores.relationships.findByOrgAndClient(orgId, clientProfileId)
			).toEqual(second);
		});

		it('allows several non-ACTIVE rows for the same org and client', async () => {
			const orgId = randomUUID();
			const clientProfileId = randomUUID();
			const a = await stores.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Revoked,
			});
			const b = await stores.relationships.create({
				orgId,
				clientProfileId,
				status: RelationshipStatus.Pending,
			});
			expect(a.id).not.toBe(b.id);
		});

		it('flips origin to CLIENT_CREATED on claim', async () => {
			const created = await stores.profiles.create({
				orgId: randomUUID(),
				name: 'Idx',
				origin: ProfileOrigin.AdvisorCreated,
			});
			const claimed = await stores.profiles.claimIfUnowned(created.id, 'u1');
			expect(claimed?.origin).toBe(ProfileOrigin.ClientCreated);
		});

		const newInvite = (tokenHash: string) => ({
			orgId: randomUUID(),
			clientProfileId: randomUUID(),
			relationshipId: randomUUID(),
			email: `${randomUUID()}@example.com`,
			tokenHash,
			status: InviteStatus.Pending,
			expiresAt: new Date('2030-01-01T00:00:00Z'),
			resendCount: 0,
			invitedByUserId: randomUUID(),
		});

		it('rejects two invites with the same token hash', async () => {
			const tokenHash = randomUUID();
			await consentStores.invites.create(newInvite(tokenHash));
			await expect(
				consentStores.invites.create(newInvite(tokenHash))
			).rejects.toMatchObject({ code: 11000 });
		});

		it('rejects rotating an invite to a token hash that already exists', async () => {
			const taken = randomUUID();
			await consentStores.invites.create(newInvite(taken));
			const other = await consentStores.invites.create(newInvite(randomUUID()));

			await expect(
				consentStores.invites.rotateToken(
					other.id,
					taken,
					new Date('2031-01-01T00:00:00Z'),
					3
				)
			).rejects.toMatchObject({ code: 11000 });
			expect(
				(await consentStores.invites.findById(other.orgId, other.id))
					?.resendCount
			).toBe(0);
		});

		it('rejects an assignment row duplicated at the index level, but assign stays idempotent under load', async () => {
			const orgId = randomUUID();
			const clientId = randomUUID();
			const userId = randomUUID();
			const rows = await Promise.all(
				Array.from({ length: 8 }, () =>
					teamStores.assignments.assign(orgId, clientId, userId, 'a')
				)
			);
			expect(new Set(rows.map((r) => r.assignment.id)).size).toBe(1);
			expect(rows.filter((r) => r.created)).toHaveLength(1);
			expect(rows.filter((r) => r.created)).toHaveLength(1);
		});

		it('rejects two member invites with the same token hash', async () => {
			const tokenHash = randomUUID();
			const invite = (): Parameters<MongoMemberInviteStore['create']>[0] => ({
				orgId: randomUUID(),
				email: `${randomUUID()}@example.com`,
				role: OrgRole.Advisor,
				tokenHash,
				status: MemberInviteStatus.Pending,
				expiresAt: new Date('2030-01-01T00:00:00Z'),
				resendCount: 0,
				invitedByUserId: randomUUID(),
			});
			await teamStores.memberInvites.create(invite());
			await expect(
				teamStores.memberInvites.create(invite())
			).rejects.toMatchObject({ code: 11000 });
		});

		it('maps the partial (org, email) index to the typed error, not E11000, and lets non-PENDING rows repeat', async () => {
			const orgId = randomUUID();
			const email = `${randomUUID()}@example.com`;
			const base = {
				orgId,
				email,
				role: OrgRole.Advisor,
				expiresAt: new Date('2030-01-01T00:00:00Z'),
				resendCount: 0,
				invitedByUserId: randomUUID(),
			};
			await teamStores.memberInvites.create({
				...base,
				tokenHash: randomUUID(),
				status: MemberInviteStatus.Pending,
			});
			await expect(
				teamStores.memberInvites.create({
					...base,
					tokenHash: randomUUID(),
					status: MemberInviteStatus.Pending,
				})
			).rejects.toBeInstanceOf(DuplicatePendingMemberInviteError);
			await teamStores.memberInvites.create({
				...base,
				tokenHash: randomUUID(),
				status: MemberInviteStatus.Declined,
			});
			await teamStores.memberInvites.create({
				...base,
				tokenHash: randomUUID(),
				status: MemberInviteStatus.Declined,
			});
		});

		it('keeps one ACTIVE consent when the same user and org are granted in parallel for one relationship', async () => {
			const userId = randomUUID();
			const orgId = randomUUID();
			const relationshipId = randomUUID();
			const grant = () =>
				consentStores.consents.grant({
					orgId,
					clientProfileId: randomUUID(),
					relationshipId,
					userId,
					portfolioIds: [randomUUID()],
					textVersion: 'v1',
					grantedAt: new Date(),
				});

			const granted = await Promise.all([grant(), grant(), grant()]);

			expect(
				await consentStores.consents.listActiveByUser(userId)
			).toHaveLength(1);
			expect(new Set(granted.map((c) => c.version)).size).toBe(3);
			const rows =
				await consentStores.consents.listByRelationship(relationshipId);
			expect(
				rows.filter((c) => c.status === ConsentStatus.Active)
			).toHaveLength(1);
		});

		it('lets only one of two parallel invites of the same org become ACTIVE', async () => {
			const userId = randomUUID();
			const orgId = randomUUID();
			const grant = () =>
				consentStores.consents.grant({
					orgId,
					clientProfileId: randomUUID(),
					relationshipId: randomUUID(),
					userId,
					portfolioIds: [randomUUID()],
					textVersion: 'v1',
					grantedAt: new Date(),
				});

			const results = await Promise.allSettled([grant(), grant()]);

			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
			expect(
				await consentStores.consents.listActiveByUser(userId)
			).toHaveLength(1);
		});

		const alertDoc = (
			overrides: Partial<AdvisorAlertDoc> = {}
		): Partial<AdvisorAlertDoc> => ({
			orgId: 'o',
			clientProfileId: 'c',
			rule: AlertRule.Concentration,
			source: null,
			key: 'k',
			conditionKey: 'CONCENTRATION:-:k',
			band: 1,
			priority: AlertPriority.P2,
			priorityRank: 2,
			messageKey: 'm',
			params: {},
			evidence: {},
			dataAsOf: '2026-11-20',
			provenance: null,
			lowConfidence: false,
			status: AlertStatus.Open,
			active: true,
			...overrides,
		});

		it('rejects a second active alert for the same condition at the index level; a closed one does not count', async () => {
			const orgId = randomUUID();
			const clientProfileId = randomUUID();
			const base = alertDoc({ orgId, clientProfileId });
			await alertModel.create(base);

			await expect(alertModel.create(base)).rejects.toMatchObject({
				code: 11000,
			});
			await alertModel.create({
				...base,
				status: AlertStatus.Handled,
				active: false,
			});
			await alertModel.create({
				...base,
				status: AlertStatus.Dismissed,
				active: false,
			});
		});

		it('stores the priority rank derived from the priority on insert and on patch', async () => {
			const orgId = randomUUID();
			const [alert] = await attentionStores.alerts.insertMany([
				{
					orgId,
					clientProfileId: randomUUID(),
					rule: AlertRule.Concentration,
					source: null,
					key: 'k',
					conditionKey: 'CONCENTRATION:-:k',
					band: 2,
					priority: AlertPriority.P1,
					messageKey: 'm',
					params: {},
					evidence: {},
					dataAsOf: '2026-11-20',
					provenance: null,
					lowConfidence: false,
					status: AlertStatus.Open,
				},
			]);
			const rank = async (): Promise<number | undefined> =>
				(await alertModel.findById(alert.id).lean<AdvisorAlertDoc>().exec())
					?.priorityRank;
			expect(await rank()).toBe(1);

			await attentionStores.alerts.patch(alert.id, {
				priority: AlertPriority.P3,
			});

			expect(await rank()).toBe(3);
		});

		it('rejects a second wealth row for the same key, and a second snapshot, settings or contact for one client', async () => {
			const orgId = randomUUID();
			const clientProfileId = randomUUID();
			const wealth = {
				orgId,
				clientProfileId,
				date: '2026-11-20',
				source: SnapshotSource.AdvisorLedger,
				portfolioId: '',
				totalMinor: 1,
				verifiedMinor: 0,
				manualMinor: 1,
			};
			await wealthModel.create(wealth);
			await expect(wealthModel.create(wealth)).rejects.toMatchObject({
				code: 11000,
			});
			await wealthModel.create({ ...wealth, portfolioId: 'p-1' });

			await contactModel.create({
				orgId,
				clientProfileId,
				lastContactAt: new Date(),
				recordedByUserId: 'u',
			});
			await expect(
				contactModel.create({
					orgId,
					clientProfileId,
					lastContactAt: new Date(),
					recordedByUserId: 'u',
				})
			).rejects.toMatchObject({ code: 11000 });

			await settingsModel.create({ orgId, engineEnabledAt: new Date() });
			await expect(
				settingsModel.create({ orgId, engineEnabledAt: new Date() })
			).rejects.toMatchObject({ code: 11000 });
		});

		it('creates the unique index of the snapshot, the alert queue index and the 400-day TTL', async () => {
			const names = async (
				model: Model<never>
			): Promise<
				Array<{ name?: string; unique?: boolean; expireAfterSeconds?: number }>
			> => model.collection.indexes();

			const snapshotIndexes = await names(snapshotModel as Model<never>);
			expect(snapshotIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: 'advisor_client_snapshot_client',
						unique: true,
					}),
				])
			);
			const alertIndexes = await names(alertModel as Model<never>);
			expect(alertIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: 'advisor_alert_client',
						key: { orgId: 1, clientProfileId: 1, createdAt: 1 },
					}),
					expect.objectContaining({
						name: 'advisor_alert_queue',
						key: { orgId: 1, status: 1, priorityRank: 1, createdAt: 1 },
					}),
					expect.objectContaining({
						name: 'advisor_alert_active_condition',
						unique: true,
						partialFilterExpression: { active: true },
					}),
				])
			);
			const wealthIndexes = await names(wealthModel as Model<never>);
			expect(WEALTH_DAILY_TTL_SECONDS).toBe(400 * 24 * 60 * 60);
			expect(wealthIndexes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: WEALTH_DAILY_TTL_INDEX,
						key: { createdAt: 1 },
						expireAfterSeconds: 34560000,
					}),
				])
			);
		});
	});
});
