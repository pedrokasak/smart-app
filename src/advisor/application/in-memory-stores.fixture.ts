import { ConflictException } from '@nestjs/common';
import type { ClientAttentionPurgePort } from './ports/client-attention-purge.port';
import type { ClientSnapshotTriggerPort } from './ports/client-snapshot-trigger.port';
import { randomUUID } from 'crypto';
import {
	AlertSettings,
	DEFAULT_ALERT_SETTINGS,
} from '../domain/alert-settings';
import { Alert, ClientSnapshot } from '../domain/attention.entities';
import { ClientInvite, Consent } from '../domain/consent.entities';
import {
	AdvisoryRelationship,
	ClientProfile,
	ERASED_CLIENT_NAME,
	Membership,
	Organization,
} from '../domain/entities';
import {
	AlertPriority,
	AlertStatus,
	AssetClass,
	ConsentStatus,
	ImportBatchStatus,
	InviteStatus,
	MemberInviteStatus,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
	SnapshotSource,
} from '../domain/enums';
import {
	AllocationTarget,
	NewTransaction,
	Transaction,
} from '../domain/portfolio.entities';
import { PortalGrant } from '../domain/portal-access';
import { ClientAssignment, MemberInvite } from '../domain/team.entities';
import { sortDeadlines } from './alert-deadline';
import {
	alertCursorOf,
	clampAlertPageSize,
	compareAlertCursor,
	decodeAlertCursor,
	encodeAlertCursor,
} from './alert-cursor';
import { decodeIdCursor, encodeIdCursor } from './id-cursor';
import {
	AlertSettingsStorePort,
	StoredAlertSettings,
} from './ports/alert-settings.store.port';
import {
	ALERT_IDS_BY_FILTER_MAX,
	AlertFilter,
	AlertListQuery,
	AlertPage,
	AlertStorePort,
	NewAlert,
	OpenAlertCounts,
} from './ports/alert.store.port';
import { AllocationTargetStorePort } from './ports/allocation-target.store.port';
import { ClientContactStorePort } from './ports/client-contact.store.port';
import { ClientSnapshotStorePort } from './ports/client-snapshot.store.port';
import {
	assertWealthRow,
	WealthDailyRow,
	WealthDailyStorePort,
	WealthDailySum,
} from './ports/wealth-daily.store.port';
import {
	AssignedClientsPage,
	AssignResult,
	AssignmentStorePort,
	ListAssignedClientsQuery,
} from './ports/assignment.store.port';
import {
	BenchmarkKey,
	BenchmarkSeriesPort,
} from './ports/benchmark-series.port';
import { ClientProfileStorePort } from './ports/client-profile.store.port';
import { ConsentStorePort } from './ports/consent.store.port';
import {
	InviteNotifierPort,
	SendInviteInput,
} from './ports/invite-notifier.port';
import { InviteStorePort } from './ports/invite.store.port';
import {
	InviteeAccount,
	InviteeIdentityPort,
} from './ports/invitee-identity.port';
import {
	MemberInviteNotifierPort,
	SendMemberInviteInput,
} from './ports/member-invite-notifier.port';
import { MemberInviteStorePort } from './ports/member-invite.store.port';
import { MembershipStorePort } from './ports/membership.store.port';
import { OrganizationStorePort } from './ports/organization.store.port';
import { PortalAccountDirectoryPort } from './ports/portal-account-directory.port';
import { PortalGrantStorePort } from './ports/portal-grant.store.port';
import { DailyCloseMinor, PriceHistoryPort } from './ports/price-history.port';
import {
	ListRelationshipsQuery,
	RelationshipPage,
	RelationshipStorePort,
} from './ports/relationship.store.port';
import {
	DuplicateMembershipError,
	DuplicateOrganizationOwnerError,
	DuplicatePendingMemberInviteError,
} from './ports/store-errors';
import {
	decodeRelationshipCursor,
	encodeRelationshipCursor,
} from './relationship-cursor';
import {
	OwnedPortfolio,
	SharedPortfolioData,
	SharedPortfolioSourcePort,
} from './ports/shared-portfolio-source.port';
import {
	DuplicateImportError,
	STALE_IMPORT_MS,
	TransactionStorePort,
} from './ports/transaction.store.port';

interface ImportClaim {
	batchId: string;
	status: ImportBatchStatus;
	createdAt: Date;
}

/** Stores em memória para testes de unidade da camada de aplicação. */
export class InMemoryOrganizationStore implements OrganizationStorePort {
	private readonly items = new Map<string, Organization>();

	async create(org: Omit<Organization, 'id'>): Promise<Organization> {
		if (
			org.ownerUserId &&
			[...this.items.values()].some((o) => o.ownerUserId === org.ownerUserId)
		) {
			throw new DuplicateOrganizationOwnerError();
		}
		const created: Organization = { ...org, id: randomUUID() };
		this.items.set(created.id, created);
		return created;
	}

	async findById(id: string): Promise<Organization | null> {
		return this.items.get(id) ?? null;
	}

	async delete(id: string): Promise<void> {
		this.items.delete(id);
	}

	async listIds(
		cursor: string | undefined,
		limit: number
	): Promise<{ ids: string[]; nextCursor: string | null }> {
		const after = cursor === undefined ? null : decodeIdCursor(cursor);
		const size = Math.min(Math.max(Math.trunc(limit) || 1, 1), 1000);
		const rest = [...this.items.keys()]
			.sort()
			.filter((id) => after === null || id > after);
		const ids = rest.slice(0, size);
		return {
			ids,
			nextCursor:
				rest.length > size ? encodeIdCursor(ids[ids.length - 1]) : null,
		};
	}
}

export class InMemoryMembershipStore implements MembershipStorePort {
	private readonly items = new Map<string, Membership>();
	private lastCreatedAtMs = 0;

	private nextStamp(): Date {
		this.lastCreatedAtMs = Math.max(Date.now(), this.lastCreatedAtMs + 1);
		return new Date(this.lastCreatedAtMs);
	}

	async create(
		membership: Omit<Membership, 'id' | 'createdAt'> & { createdAt?: Date }
	): Promise<Membership> {
		if (
			[...this.items.values()].some(
				(m) => m.userId === membership.userId && m.orgId === membership.orgId
			)
		) {
			throw new DuplicateMembershipError();
		}
		const created: Membership = {
			...membership,
			id: randomUUID(),
			// Estritamente crescente: a ordem não depende do relógio.
			createdAt: membership.createdAt ?? this.nextStamp(),
		};
		this.items.set(created.id, created);
		return created;
	}

	async findByUser(userId: string): Promise<Membership[]> {
		return this.ordered((m) => m.userId === userId);
	}

	async findByUserAndOrg(
		userId: string,
		orgId: string
	): Promise<Membership | null> {
		return (
			[...this.items.values()].find(
				(m) => m.userId === userId && m.orgId === orgId
			) ?? null
		);
	}

	async delete(userId: string, orgId: string): Promise<boolean> {
		const found = await this.findByUserAndOrg(userId, orgId);
		return found !== null && this.items.delete(found.id);
	}

	async setRole(
		userId: string,
		orgId: string,
		role: OrgRole
	): Promise<Membership | null> {
		const found = await this.findByUserAndOrg(userId, orgId);
		if (!found) return null;
		const updated: Membership = { ...found, role };
		this.items.set(found.id, updated);
		return { ...updated };
	}

	async listByOrg(orgId: string): Promise<Membership[]> {
		return this.ordered((m) => m.orgId === orgId).slice(0, 200);
	}

	/** `createdAt` crescente, desempate por id (como o Mongo). */
	private ordered(predicate: (m: Membership) => boolean): Membership[] {
		return [...this.items.values()]
			.filter(predicate)
			.sort(
				(a, b) =>
					a.createdAt.getTime() - b.createdAt.getTime() ||
					(a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
			)
			.map((m) => ({ ...m }));
	}

	async deleteAllForUser(userId: string): Promise<number> {
		let removed = 0;
		for (const [id, membership] of this.items) {
			if (membership.userId === userId) {
				this.items.delete(id);
				removed += 1;
			}
		}
		return removed;
	}
}

export class InMemoryRelationshipStore implements RelationshipStorePort {
	private readonly items = new Map<string, AdvisoryRelationship>();
	/** Instante de criação por id, estritamente crescente (ordem de `listByOrg`). */
	private readonly createdAt = new Map<string, Date>();
	private lastCreatedAtMs = 0;

	/**
	 * Fonte das atribuições para `listUnassignedByOrg`; sem ela esse método
	 * lança, para o teste esquecido falhar alto em vez de divergir do Mongo.
	 */
	constructor(private readonly assignments?: AssignmentStorePort) {}

	private stamp(id: string): void {
		if (this.createdAt.has(id)) return;
		this.lastCreatedAtMs = Math.max(Date.now(), this.lastCreatedAtMs + 1);
		this.createdAt.set(id, new Date(this.lastCreatedAtMs));
	}

	/** Só para testes: todas as relações gravadas. */
	get all(): AdvisoryRelationship[] {
		return [...this.items.values()];
	}

	/** Só para testes: quantidade de itens gravados. */
	get size(): number {
		return this.items.size;
	}

	async create(
		relationship: Omit<AdvisoryRelationship, 'id'>
	): Promise<AdvisoryRelationship> {
		const created: AdvisoryRelationship = { ...relationship, id: randomUUID() };
		this.items.set(created.id, created);
		this.stamp(created.id);
		return created;
	}

	async findById(id: string): Promise<AdvisoryRelationship | null> {
		return this.items.get(id) ?? null;
	}

	async findCreatedAt(id: string): Promise<Date | null> {
		const at = this.createdAt.get(id);
		return at ? new Date(at) : null;
	}

	/** Só para testes: muda a data de criação (relação antiga). */
	setCreatedAt(id: string, at: Date): void {
		if (this.createdAt.has(id)) this.createdAt.set(id, new Date(at));
	}

	async findByOrgAndClient(
		orgId: string,
		clientProfileId: string
	): Promise<AdvisoryRelationship | null> {
		// Map preserva a ordem de criação; o último é o mais recente.
		const matches = [...this.items.values()].filter(
			(r) => r.orgId === orgId && r.clientProfileId === clientProfileId
		);
		return (
			matches.find((r) => r.status === RelationshipStatus.Active) ??
			matches[matches.length - 1] ??
			null
		);
	}

	async save(
		relationship: AdvisoryRelationship
	): Promise<AdvisoryRelationship> {
		this.items.set(relationship.id, relationship);
		this.stamp(relationship.id);
		return relationship;
	}

	async activate(
		id: string,
		consentId: string
	): Promise<AdvisoryRelationship | null> {
		const current = this.items.get(id);
		if (!current || current.status !== RelationshipStatus.Pending) {
			return null;
		}
		const updated: AdvisoryRelationship = {
			...current,
			status: RelationshipStatus.Active,
			consentId,
		};
		this.items.set(id, updated);
		return updated;
	}

	async setConsentIfActive(
		id: string,
		consentId: string
	): Promise<AdvisoryRelationship | null> {
		const current = this.items.get(id);
		if (!current || current.status !== RelationshipStatus.Active) {
			return null;
		}
		const updated: AdvisoryRelationship = { ...current, consentId };
		this.items.set(id, updated);
		return updated;
	}

	async listByOrg(
		orgId: string,
		query: ListRelationshipsQuery
	): Promise<RelationshipPage> {
		return this.page(orgId, query, () => true);
	}

	async listUnassignedByOrg(
		orgId: string,
		query: ListRelationshipsQuery
	): Promise<RelationshipPage> {
		const assignments = this.assignments;
		if (!assignments) {
			throw new Error(
				'InMemoryRelationshipStore.listUnassignedByOrg needs an AssignmentStorePort: build it with new InMemoryRelationshipStore(assignments)'
			);
		}
		const assigned = new Set<string>();
		for (const r of this.items.values()) {
			if (r.orgId !== orgId) continue;
			const rows = await assignments.listByClient(orgId, r.clientProfileId);
			if (rows.length > 0) assigned.add(r.clientProfileId);
		}
		return this.page(orgId, query, (r) => !assigned.has(r.clientProfileId));
	}

	async deleteById(id: string): Promise<void> {
		this.items.delete(id);
		this.createdAt.delete(id);
	}

	private page(
		orgId: string,
		query: ListRelationshipsQuery,
		keep: (r: AdvisoryRelationship) => boolean
	): RelationshipPage {
		const statuses = new Set(query.statuses);
		const cursor = query.cursor ? decodeRelationshipCursor(query.cursor) : null;
		const key = (r: AdvisoryRelationship) => ({
			createdAt: this.createdAt.get(r.id) as Date,
			id: r.id,
		});
		// createdAt decrescente, desempate por id decrescente.
		const ordered = [...this.items.values()]
			.filter((r) => r.orgId === orgId && statuses.has(r.status) && keep(r))
			.sort((a, b) => {
				const ka = key(a);
				const kb = key(b);
				return (
					kb.createdAt.getTime() - ka.createdAt.getTime() ||
					(ka.id < kb.id ? 1 : ka.id > kb.id ? -1 : 0)
				);
			})
			.filter((r) => {
				if (!cursor) return true;
				const k = key(r);
				const diff = k.createdAt.getTime() - cursor.createdAt.getTime();
				return diff < 0 || (diff === 0 && k.id < cursor.id);
			});
		const items = ordered.slice(0, query.limit).map((r) => ({ ...r }));
		const last = items[items.length - 1];
		return {
			items,
			nextCursor:
				ordered.length > query.limit && last
					? encodeRelationshipCursor(key(last))
					: null,
		};
	}

	async listActiveByClientProfiles(
		clientProfileIds: string[]
	): Promise<AdvisoryRelationship[]> {
		const ids = new Set(clientProfileIds);
		return [...this.items.values()]
			.filter(
				(r) =>
					ids.has(r.clientProfileId) && r.status === RelationshipStatus.Active
			)
			.map((r) => ({ ...r }));
	}
}

export class InMemoryClientProfileStore implements ClientProfileStorePort {
	private readonly items = new Map<string, ClientProfile>();

	/** Só para testes: quantidade de itens gravados. */
	get size(): number {
		return this.items.size;
	}

	/** Só para testes: grava um perfil com id escolhido. */
	seed(profile: ClientProfile): ClientProfile {
		this.items.set(profile.id, { ...profile });
		return profile;
	}

	async create(profile: Omit<ClientProfile, 'id'>): Promise<ClientProfile> {
		const created: ClientProfile = { ...profile, id: randomUUID() };
		this.items.set(created.id, created);
		return created;
	}

	async findById(id: string): Promise<ClientProfile | null> {
		return this.items.get(id) ?? null;
	}

	async findByIds(orgId: string, ids: string[]): Promise<ClientProfile[]> {
		const wanted = new Set(ids);
		return [...this.items.values()]
			.filter((p) => p.orgId === orgId && wanted.has(p.id))
			.map((p) => ({ ...p }));
	}

	async claimIfUnowned(
		id: string,
		userId: string
	): Promise<ClientProfile | null> {
		const profile = this.items.get(id);
		if (
			!profile ||
			profile.origin !== ProfileOrigin.AdvisorCreated ||
			profile.ownerUserId
		) {
			return null;
		}
		const claimed: ClientProfile = {
			...profile,
			origin: ProfileOrigin.ClientCreated,
			ownerUserId: userId,
		};
		this.items.set(id, claimed);
		return claimed;
	}

	async setOwnerIfUnowned(
		id: string,
		userId: string
	): Promise<ClientProfile | null> {
		const profile = this.items.get(id);
		if (
			!profile ||
			profile.origin !== ProfileOrigin.ClientCreated ||
			profile.ownerUserId
		) {
			return null;
		}
		const owned: ClientProfile = { ...profile, ownerUserId: userId };
		this.items.set(id, owned);
		return owned;
	}

	async anonymizeByOwner(userId: string): Promise<number> {
		let changed = 0;
		for (const [id, profile] of this.items) {
			if (profile.ownerUserId !== userId) continue;
			this.items.set(id, {
				id: profile.id,
				orgId: profile.orgId,
				origin: profile.origin,
				name: ERASED_CLIENT_NAME,
			});
			changed += 1;
		}
		return changed;
	}

	async listIdsByOwner(userId: string): Promise<string[]> {
		return [...this.items.values()]
			.filter((p) => p.ownerUserId === userId)
			.map((p) => p.id);
	}

	async deleteById(id: string): Promise<void> {
		this.items.delete(id);
	}
}

export class InMemoryTransactionStore implements TransactionStorePort {
	private readonly items = new Map<string, Transaction>();
	/** chave (org, cliente, hash) -> lote */
	private readonly claims = new Map<string, ImportClaim>();

	async createMany(items: NewTransaction[]): Promise<Transaction[]> {
		const createdAt = new Date();
		const created = items.map(
			(item): Transaction => ({ ...item, id: randomUUID(), createdAt })
		);
		for (const tx of created) this.items.set(tx.id, tx);
		return created;
	}

	async listByClient(
		orgId: string,
		clientProfileId: string
	): Promise<Transaction[]> {
		return [...this.items.values()]
			.filter((t) => t.orgId === orgId && t.clientProfileId === clientProfileId)
			.sort(
				(a, b) =>
					a.tradeDate.localeCompare(b.tradeDate) ||
					a.createdAt.getTime() - b.createdAt.getTime()
			);
	}

	async findById(
		orgId: string,
		clientProfileId: string,
		id: string
	): Promise<Transaction | null> {
		const tx = this.items.get(id);
		return tx && tx.orgId === orgId && tx.clientProfileId === clientProfileId
			? tx
			: null;
	}

	async deleteById(
		orgId: string,
		clientProfileId: string,
		id: string
	): Promise<boolean> {
		return (
			(await this.findById(orgId, clientProfileId, id)) !== null &&
			this.items.delete(id)
		);
	}

	async claimImport(
		orgId: string,
		clientProfileId: string,
		sourceHash: string,
		_createdByUserId?: string,
		now: Date = new Date()
	): Promise<string> {
		const key = JSON.stringify([orgId, clientProfileId, sourceHash]);
		const existing = this.claims.get(key);
		if (existing) {
			const stale =
				existing.status === ImportBatchStatus.Pending &&
				now.getTime() - existing.createdAt.getTime() > STALE_IMPORT_MS;
			if (!stale) throw new DuplicateImportError();
		}
		// Reserva antes de qualquer await: duas retomadas simultâneas não passam.
		const batchId = randomUUID();
		this.claims.set(key, {
			batchId,
			status: ImportBatchStatus.Pending,
			createdAt: now,
		});
		if (existing) {
			await this.discardImport(orgId, clientProfileId, existing.batchId);
		}
		return batchId;
	}

	async completeImport(
		orgId: string,
		clientProfileId: string,
		importBatchId: string
	): Promise<void> {
		for (const [key, claim] of this.claims) {
			const [claimOrg, claimClient] = JSON.parse(key) as string[];
			if (
				claim.batchId === importBatchId &&
				claimOrg === orgId &&
				claimClient === clientProfileId
			) {
				claim.status = ImportBatchStatus.Completed;
			}
		}
	}

	async discardImport(
		orgId: string,
		clientProfileId: string,
		importBatchId: string
	): Promise<void> {
		for (const [id, tx] of this.items) {
			if (
				tx.orgId === orgId &&
				tx.clientProfileId === clientProfileId &&
				tx.importBatchId === importBatchId
			) {
				this.items.delete(id);
			}
		}
		for (const [key, claim] of this.claims) {
			const [claimOrg, claimClient] = JSON.parse(key) as string[];
			if (
				claim.batchId === importBatchId &&
				claimOrg === orgId &&
				claimClient === clientProfileId
			) {
				this.claims.delete(key);
			}
		}
	}
}

export class InMemoryAllocationTargetStore implements AllocationTargetStorePort {
	private readonly items = new Map<string, AllocationTarget>();

	async upsert(
		target: Omit<AllocationTarget, 'updatedAt'>
	): Promise<AllocationTarget> {
		const saved: AllocationTarget = { ...target, updatedAt: new Date() };
		this.items.set(
			JSON.stringify([target.orgId, target.clientProfileId]),
			saved
		);
		return saved;
	}

	async find(
		orgId: string,
		clientProfileId: string
	): Promise<AllocationTarget | null> {
		return this.items.get(JSON.stringify([orgId, clientProfileId])) ?? null;
	}
}

/** Fonte de preços em memória; `failFor` faz o símbolo rejeitar. */
export class InMemoryPriceHistory implements PriceHistoryPort {
	private readonly series = new Map<string, DailyCloseMinor[]>();
	private readonly failing = new Set<string>();
	readonly calls: Array<{
		symbol: string;
		assetClass: AssetClass;
		from: string;
		to: string;
	}> = [];
	private inFlight = 0;
	maxInFlight = 0;

	set(symbol: string, closes: DailyCloseMinor[]): void {
		this.series.set(symbol, closes);
	}

	failFor(symbol: string): void {
		this.failing.add(symbol);
	}

	async getDailyCloses(
		symbol: string,
		assetClass: AssetClass,
		from: string,
		to: string
	): Promise<DailyCloseMinor[]> {
		this.calls.push({ symbol, assetClass, from, to });
		this.inFlight += 1;
		this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
		try {
			await new Promise((resolve) => setImmediate(resolve));
			if (this.failing.has(symbol)) {
				throw new Error('price source unavailable');
			}
			return (this.series.get(symbol) ?? []).filter(
				(c) => c.date >= from && c.date <= to
			);
		} finally {
			this.inFlight -= 1;
		}
	}
}

/** Benchmarks em memória; `failFor` faz o índice rejeitar. */
export class InMemoryBenchmarkSeries implements BenchmarkSeriesPort {
	private readonly values = new Map<BenchmarkKey, number | null>();
	private readonly failing = new Set<BenchmarkKey>();
	readonly calls: Array<{ key: BenchmarkKey; from: string; to: string }> = [];

	set(key: BenchmarkKey, value: number | null): void {
		this.values.set(key, value);
	}

	failFor(key: BenchmarkKey): void {
		this.failing.add(key);
	}

	async periodReturn(
		key: BenchmarkKey,
		from: string,
		to: string
	): Promise<number | null> {
		this.calls.push({ key, from, to });
		if (this.failing.has(key)) throw new Error('benchmark unavailable');
		return this.values.get(key) ?? null;
	}
}

export class InMemoryInviteStore implements InviteStorePort {
	private readonly items = new Map<string, ClientInvite>();

	/** Só para testes: quantidade de itens gravados. */
	get size(): number {
		return this.items.size;
	}

	async create(
		invite: Omit<ClientInvite, 'id' | 'createdAt'>
	): Promise<ClientInvite> {
		const created: ClientInvite = {
			...invite,
			id: randomUUID(),
			createdAt: new Date(),
		};
		this.items.set(created.id, created);
		return { ...created };
	}

	async findByTokenHash(tokenHash: string): Promise<ClientInvite | null> {
		return (
			[...this.items.values()].find((i) => i.tokenHash === tokenHash) ?? null
		);
	}

	async findById(orgId: string, id: string): Promise<ClientInvite | null> {
		const found = this.items.get(id);
		return found && found.orgId === orgId ? found : null;
	}

	async findPendingByOrgAndEmail(
		orgId: string,
		email: string
	): Promise<ClientInvite[]> {
		return [...this.items.values()].filter(
			(i) =>
				i.orgId === orgId &&
				i.email === email &&
				i.status === InviteStatus.Pending
		);
	}

	async listPendingByOrg(orgId: string, now: Date): Promise<ClientInvite[]> {
		// Map preserva a ordem de criação; o mais recente primeiro.
		return [...this.items.values()]
			.filter(
				(i) =>
					i.orgId === orgId &&
					i.status === InviteStatus.Pending &&
					i.expiresAt.getTime() > now.getTime()
			)
			.reverse()
			.slice(0, 200)
			.map((i) => ({ ...i }));
	}

	async transition(
		id: string,
		to: InviteStatus,
		at: Date
	): Promise<ClientInvite | null> {
		const current = this.items.get(id);
		if (!current || current.status !== InviteStatus.Pending) {
			return null;
		}
		const updated: ClientInvite = { ...current, status: to, respondedAt: at };
		this.items.set(id, updated);
		return { ...updated };
	}

	async rotateToken(
		id: string,
		tokenHash: string,
		expiresAt: Date,
		max: number
	): Promise<ClientInvite | null> {
		const current = this.items.get(id);
		if (
			!current ||
			current.status !== InviteStatus.Pending ||
			current.resendCount >= max
		) {
			return null;
		}
		const updated: ClientInvite = {
			...current,
			tokenHash,
			expiresAt,
			resendCount: current.resendCount + 1,
		};
		this.items.set(id, updated);
		return { ...updated };
	}

	async findAcceptedByRelationship(
		relationshipId: string
	): Promise<ClientInvite | null> {
		const stamp = (i: ClientInvite): number =>
			(i.respondedAt ?? i.createdAt).getTime();
		const [latest] = [...this.items.values()]
			.filter(
				(i) =>
					i.relationshipId === relationshipId &&
					i.status === InviteStatus.Accepted
			)
			.sort((a, b) => stamp(b) - stamp(a));
		return latest ? { ...latest } : null;
	}

	async deleteByEmail(email: string): Promise<number> {
		let removed = 0;
		for (const [id, invite] of this.items) {
			if (invite.email === email) {
				this.items.delete(id);
				removed += 1;
			}
		}
		return removed;
	}

	async deleteByRelationshipIds(relationshipIds: string[]): Promise<number> {
		const ids = new Set(relationshipIds);
		let removed = 0;
		for (const [id, invite] of this.items) {
			if (ids.has(invite.relationshipId)) {
				this.items.delete(id);
				removed += 1;
			}
		}
		return removed;
	}
}

export class InMemoryConsentStore implements ConsentStorePort {
	private readonly items = new Map<string, Consent>();

	/**
	 * Tudo síncrono antes de qualquer await: dois grants não se intercalam. Como
	 * o índice único parcial do Mongo, recusa um segundo vínculo ACTIVE do mesmo
	 * usuário com a mesma organização por outra relação.
	 */
	async grant(
		consent: Omit<Consent, 'id' | 'version' | 'status' | 'endedAt'>
	): Promise<Consent> {
		const linkedElsewhere = [...this.items.values()].some(
			(c) =>
				c.userId === consent.userId &&
				c.orgId === consent.orgId &&
				c.status === ConsentStatus.Active &&
				c.relationshipId !== consent.relationshipId
		);
		if (linkedElsewhere) {
			throw new ConflictException('Already linked to this organization');
		}
		const ofRelationship = [...this.items.values()].filter(
			(c) => c.relationshipId === consent.relationshipId
		);
		const version = Math.max(0, ...ofRelationship.map((c) => c.version)) + 1;
		for (const previous of ofRelationship) {
			if (previous.status === ConsentStatus.Active) {
				this.items.set(previous.id, {
					...previous,
					status: ConsentStatus.Superseded,
					endedAt: consent.grantedAt,
				});
			}
		}
		const created: Consent = {
			...consent,
			id: randomUUID(),
			version,
			status: ConsentStatus.Active,
		};
		this.items.set(created.id, created);
		return { ...created, portfolioIds: [...created.portfolioIds] };
	}

	async listByRelationship(relationshipId: string): Promise<Consent[]> {
		return [...this.items.values()]
			.filter((c) => c.relationshipId === relationshipId)
			.sort((a, b) => a.version - b.version)
			.map((c) => ({ ...c, portfolioIds: [...c.portfolioIds] }));
	}

	async findActiveByRelationship(
		relationshipId: string
	): Promise<Consent | null> {
		return (
			[...this.items.values()].find(
				(c) =>
					c.relationshipId === relationshipId &&
					c.status === ConsentStatus.Active
			) ?? null
		);
	}

	async listActiveByUser(userId: string): Promise<Consent[]> {
		return [...this.items.values()].filter(
			(c) => c.userId === userId && c.status === ConsentStatus.Active
		);
	}

	async listByUser(userId: string): Promise<Consent[]> {
		return [...this.items.values()]
			.filter((c) => c.userId === userId)
			.map((c) => ({ ...c, portfolioIds: [...c.portfolioIds] }));
	}

	async revokeActive(
		relationshipId: string,
		userId: string,
		at: Date
	): Promise<Consent | null> {
		const active = [...this.items.values()].find(
			(c) =>
				c.relationshipId === relationshipId &&
				c.userId === userId &&
				c.status === ConsentStatus.Active
		);
		if (!active) {
			return null;
		}
		const revoked: Consent = {
			...active,
			status: ConsentStatus.Revoked,
			endedAt: at,
		};
		this.items.set(revoked.id, revoked);
		return revoked;
	}

	async deleteByUser(userId: string): Promise<number> {
		let removed = 0;
		for (const [id, consent] of this.items) {
			if (consent.userId === userId) {
				this.items.delete(id);
				removed += 1;
			}
		}
		return removed;
	}
}

/**
 * Notifier em memória: `attempts` guarda toda tentativa, `sent` só as que
 * deram certo; `failWith` faz o envio rejeitar.
 */
export class InMemoryInviteNotifier implements InviteNotifierPort {
	readonly attempts: SendInviteInput[] = [];
	readonly sent: SendInviteInput[] = [];
	failWith?: Error;

	async sendInvite(input: SendInviteInput): Promise<void> {
		this.attempts.push(input);
		if (this.failWith) throw this.failWith;
		this.sent.push(input);
	}
}

/** E-mails de convite de membro em memória; `failWith` simula a falha. */
export class InMemoryMemberInviteNotifier implements MemberInviteNotifierPort {
	readonly attempts: SendMemberInviteInput[] = [];
	readonly sent: SendMemberInviteInput[] = [];
	failWith?: Error;

	async sendMemberInvite(input: SendMemberInviteInput): Promise<void> {
		this.attempts.push(input);
		if (this.failWith) throw this.failWith;
		this.sent.push(input);
	}
}

/** Contas de investidor em memória, por userId. */
export class InMemoryInviteeIdentity implements InviteeIdentityPort {
	private readonly accounts = new Map<string, InviteeAccount>();

	set(userId: string, account: InviteeAccount): void {
		this.accounts.set(userId, account);
	}

	readonly verifiedCalls: Array<[string, string]> = [];
	failVerifyWith?: Error;

	async find(userId: string): Promise<InviteeAccount | null> {
		const account = this.accounts.get(userId);
		return account ? { ...account } : null;
	}

	async markEmailVerified(userId: string, email: string): Promise<void> {
		if (this.failVerifyWith) throw this.failVerifyWith;
		this.verifiedCalls.push([userId, email]);
	}
}

/** Carteiras B2C em memória, cada uma com o seu dono. */
export class InMemorySharedPortfolioSource implements SharedPortfolioSourcePort {
	private readonly portfolios = new Map<
		string,
		{ ownerId: string; data: SharedPortfolioData }
	>();

	add(
		ownerId: string,
		portfolio: OwnedPortfolio & Partial<SharedPortfolioData>
	): void {
		this.portfolios.set(portfolio.id, {
			ownerId,
			data: {
				portfolioId: portfolio.id,
				name: portfolio.name,
				holdings: portfolio.holdings ?? [],
				trades: portfolio.trades ?? [],
			},
		});
	}

	async listOwned(userId: string): Promise<OwnedPortfolio[]> {
		return [...this.portfolios.values()]
			.filter((p) => p.ownerId === userId)
			.map((p) => ({ id: p.data.portfolioId, name: p.data.name }));
	}

	async read(
		userId: string,
		portfolioIds: string[]
	): Promise<SharedPortfolioData[]> {
		return portfolioIds
			.map((id) => this.portfolios.get(id))
			.filter((p) => p && p.ownerId === userId)
			.map((p) => structuredClone(p.data));
	}
}

/** Liberações do portal em memória; uma ativa por usuário. */
export class InMemoryPortalGrantStore implements PortalGrantStorePort {
	private readonly grants: PortalGrant[] = [];

	async grant(
		userId: string,
		grantedBy: string,
		at: Date
	): Promise<PortalGrant> {
		const active = this.active(userId);
		if (active) return { ...active };
		const created: PortalGrant = {
			id: randomUUID(),
			userId,
			grantedBy,
			grantedAt: at,
		};
		this.grants.push(created);
		return { ...created };
	}

	async revoke(userId: string, at: Date): Promise<boolean> {
		const active = this.active(userId);
		if (!active) return false;
		active.revokedAt = at;
		return true;
	}

	async findActive(userId: string): Promise<PortalGrant | null> {
		const active = this.active(userId);
		return active ? { ...active } : null;
	}

	async listActive(): Promise<PortalGrant[]> {
		return this.grants.filter((g) => !g.revokedAt).map((g) => ({ ...g }));
	}

	async deleteAllForUser(userId: string): Promise<number> {
		const kept = this.grants.filter((g) => g.userId !== userId);
		const removed = this.grants.length - kept.length;
		this.grants.splice(0, this.grants.length, ...kept);
		return removed;
	}

	private active(userId: string): PortalGrant | undefined {
		return this.grants.find((g) => g.userId === userId && !g.revokedAt);
	}
}

/** Contas B2C em memória para a liberação do portal, por userId. */
export class InMemoryPortalAccountDirectory implements PortalAccountDirectoryPort {
	private readonly emails = new Map<string, string>();
	private readonly names = new Map<string, string>();

	set(userId: string, email: string, name = ''): void {
		this.emails.set(userId, email);
		this.names.set(userId, name);
	}

	async findUserIdByEmail(email: string): Promise<string | null> {
		for (const [userId, stored] of this.emails) {
			if (stored === email) return userId;
		}
		return null;
	}

	async findEmails(userIds: string[]): Promise<Map<string, string>> {
		const found = new Map<string, string>();
		for (const userId of userIds) {
			const email = this.emails.get(userId);
			if (email) found.set(userId, email);
		}
		return found;
	}

	async findProfiles(
		userIds: string[]
	): Promise<Map<string, { name: string; email: string }>> {
		const found = new Map<string, { name: string; email: string }>();
		for (const userId of userIds) {
			const email = this.emails.get(userId);
			if (email) {
				found.set(userId, { name: this.names.get(userId) ?? '', email });
			}
		}
		return found;
	}
}

export class InMemoryAssignmentStore implements AssignmentStorePort {
	private readonly items = new Map<string, ClientAssignment>();
	private lastCreatedAtMs = 0;

	/** Só para testes: quantidade de itens gravados. */
	get size(): number {
		return this.items.size;
	}

	async assign(
		orgId: string,
		clientProfileId: string,
		userId: string,
		assignedBy: string
	): Promise<AssignResult> {
		const existing = this.find(orgId, clientProfileId, userId);
		if (existing) return { assignment: { ...existing }, created: false };
		// Estritamente crescente: a ordem de listagem não depende do relógio.
		this.lastCreatedAtMs = Math.max(Date.now(), this.lastCreatedAtMs + 1);
		const created: ClientAssignment = {
			id: randomUUID(),
			orgId,
			clientProfileId,
			userId,
			assignedBy,
			createdAt: new Date(this.lastCreatedAtMs),
		};
		this.items.set(created.id, created);
		return { assignment: { ...created }, created: true };
	}

	async unassign(
		orgId: string,
		clientProfileId: string,
		userId: string
	): Promise<boolean> {
		const found = this.find(orgId, clientProfileId, userId);
		return found !== undefined && this.items.delete(found.id);
	}

	async isAssigned(
		orgId: string,
		clientProfileId: string,
		userId: string
	): Promise<boolean> {
		return this.find(orgId, clientProfileId, userId) !== undefined;
	}

	async listByClient(
		orgId: string,
		clientProfileId: string
	): Promise<ClientAssignment[]> {
		return this.ordered(
			(a) => a.orgId === orgId && a.clientProfileId === clientProfileId
		).map((a) => ({ ...a }));
	}

	async listClientIdsByUser(
		orgId: string,
		userId: string,
		query: ListAssignedClientsQuery
	): Promise<AssignedClientsPage> {
		const cursor = query.cursor ? decodeRelationshipCursor(query.cursor) : null;
		const rows = this.ordered(
			(a) => a.orgId === orgId && a.userId === userId
		).filter((a) => {
			if (!cursor) return true;
			const diff = a.createdAt.getTime() - cursor.createdAt.getTime();
			return diff > 0 || (diff === 0 && a.id > cursor.id);
		});
		const page = rows.slice(0, query.limit);
		const last = page[page.length - 1];
		return {
			ids: page.map((a) => a.clientProfileId),
			nextCursor:
				rows.length > query.limit && last
					? encodeRelationshipCursor({
							createdAt: last.createdAt,
							id: last.id,
						})
					: null,
		};
	}

	async deleteByUser(orgId: string, userId: string): Promise<number> {
		return this.removeWhere((a) => a.orgId === orgId && a.userId === userId);
	}

	async deleteAllForUser(userId: string): Promise<number> {
		return this.removeWhere((a) => a.userId === userId);
	}

	async deleteByClient(
		orgId: string,
		clientProfileId: string
	): Promise<number> {
		return this.removeWhere(
			(a) => a.orgId === orgId && a.clientProfileId === clientProfileId
		);
	}

	private find(
		orgId: string,
		clientProfileId: string,
		userId: string
	): ClientAssignment | undefined {
		return [...this.items.values()].find(
			(a) =>
				a.orgId === orgId &&
				a.clientProfileId === clientProfileId &&
				a.userId === userId
		);
	}

	private ordered(
		predicate: (a: ClientAssignment) => boolean
	): ClientAssignment[] {
		return [...this.items.values()]
			.filter(predicate)
			.sort(
				(a, b) =>
					a.createdAt.getTime() - b.createdAt.getTime() ||
					(a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
			);
	}

	private removeWhere(predicate: (a: ClientAssignment) => boolean): number {
		let removed = 0;
		for (const [id, a] of this.items) {
			if (predicate(a)) {
				this.items.delete(id);
				removed += 1;
			}
		}
		return removed;
	}
}

export class InMemoryMemberInviteStore implements MemberInviteStorePort {
	private readonly items = new Map<string, MemberInvite>();

	/** Só para testes: quantidade de itens gravados. */
	get size(): number {
		return this.items.size;
	}

	async create(
		invite: Omit<MemberInvite, 'id' | 'createdAt'>
	): Promise<MemberInvite> {
		if (
			invite.status === MemberInviteStatus.Pending &&
			[...this.items.values()].some(
				(i) =>
					i.orgId === invite.orgId &&
					i.email === invite.email &&
					i.status === MemberInviteStatus.Pending
			)
		) {
			throw new DuplicatePendingMemberInviteError();
		}
		const created: MemberInvite = {
			...invite,
			id: randomUUID(),
			createdAt: new Date(),
		};
		this.items.set(created.id, created);
		return { ...created };
	}

	async findById(orgId: string, id: string): Promise<MemberInvite | null> {
		const found = this.items.get(id);
		return found && found.orgId === orgId ? { ...found } : null;
	}

	async findByTokenHash(tokenHash: string): Promise<MemberInvite | null> {
		const found = [...this.items.values()].find(
			(i) => i.tokenHash === tokenHash
		);
		return found ? { ...found } : null;
	}

	async findPendingByOrgAndEmail(
		orgId: string,
		email: string,
		now: Date
	): Promise<MemberInvite | null> {
		const found = [...this.items.values()].find(
			(i) =>
				i.orgId === orgId &&
				i.email === email &&
				i.status === MemberInviteStatus.Pending &&
				i.expiresAt.getTime() > now.getTime()
		);
		return found ? { ...found } : null;
	}

	async listPendingByOrg(orgId: string, now: Date): Promise<MemberInvite[]> {
		// Map preserva a ordem de criação; o mais recente primeiro.
		return [...this.items.values()]
			.filter(
				(i) =>
					i.orgId === orgId &&
					i.status === MemberInviteStatus.Pending &&
					i.expiresAt.getTime() > now.getTime()
			)
			.reverse()
			.slice(0, 200)
			.map((i) => ({ ...i }));
	}

	async transition(
		id: string,
		from: MemberInviteStatus,
		to: MemberInviteStatus,
		at: Date
	): Promise<MemberInvite | null> {
		const current = this.items.get(id);
		if (!current || current.status !== from) return null;
		const updated: MemberInvite = { ...current, status: to, respondedAt: at };
		if (to === MemberInviteStatus.Pending) delete updated.respondedAt;
		this.items.set(id, updated);
		return { ...updated };
	}

	async rotateToken(
		id: string,
		tokenHash: string,
		expiresAt: Date,
		max: number
	): Promise<MemberInvite | null> {
		const current = this.items.get(id);
		if (
			!current ||
			current.status !== MemberInviteStatus.Pending ||
			current.resendCount >= max
		) {
			return null;
		}
		const updated: MemberInvite = {
			...current,
			tokenHash,
			expiresAt,
			resendCount: current.resendCount + 1,
		};
		this.items.set(id, updated);
		return { ...updated };
	}

	async deleteById(id: string): Promise<void> {
		this.items.delete(id);
	}

	async deleteByEmail(email: string): Promise<number> {
		let removed = 0;
		for (const [id, invite] of this.items) {
			if (invite.email === email) {
				this.items.delete(id);
				removed += 1;
			}
		}
		return removed;
	}
}

/**
 * Cópia profunda de dados simples (objetos, listas, datas). Não usa
 * `structuredClone`: sob o jest ele devolve `Date` de outro realm, que falha
 * em `instanceof Date`.
 */
const copy = <T>(value: T): T => {
	if (value instanceof Date) return new Date(value.getTime()) as T;
	if (Array.isArray(value)) return value.map((v) => copy(v)) as T;
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, copy(v)])
		) as T;
	}
	return value;
};

/** Sem filtro por clientes: `undefined`; lista vazia não casa ninguém. */
const inClients = (clientIds: string[] | undefined, id: string): boolean =>
	clientIds === undefined || clientIds.includes(id);

export class InMemoryClientSnapshotStore implements ClientSnapshotStorePort {
	private readonly items = new Map<string, ClientSnapshot>();

	private key(orgId: string, clientProfileId: string): string {
		return JSON.stringify([orgId, clientProfileId]);
	}

	async upsert(snapshot: ClientSnapshot): Promise<void> {
		this.items.set(
			this.key(snapshot.orgId, snapshot.clientProfileId),
			copy(snapshot)
		);
	}

	async find(
		orgId: string,
		clientProfileId: string
	): Promise<ClientSnapshot | null> {
		const found = this.items.get(this.key(orgId, clientProfileId));
		return found ? copy(found) : null;
	}

	async listByOrg(
		orgId: string,
		clientIds?: string[]
	): Promise<ClientSnapshot[]> {
		return [...this.items.values()]
			.filter(
				(s) => s.orgId === orgId && inClients(clientIds, s.clientProfileId)
			)
			.sort((a, b) =>
				a.clientProfileId < b.clientProfileId
					? -1
					: a.clientProfileId > b.clientProfileId
						? 1
						: 0
			)
			.map(copy);
	}

	async delete(orgId: string, clientProfileId: string): Promise<void> {
		this.items.delete(this.key(orgId, clientProfileId));
	}
}

export class InMemoryWealthDailyStore implements WealthDailyStorePort {
	private readonly rows = new Map<string, WealthDailyRow>();

	/** Só para testes: todas as linhas gravadas. */
	get all(): WealthDailyRow[] {
		return [...this.rows.values()].map((r) => ({ ...r }));
	}

	async upsert(row: WealthDailyRow): Promise<void> {
		assertWealthRow(row);
		const key = JSON.stringify([
			row.orgId,
			row.clientProfileId,
			row.date,
			row.source,
			row.portfolioId ?? '',
		]);
		this.rows.set(key, { ...row });
	}

	async deleteSource(
		orgId: string,
		clientProfileId: string,
		source: SnapshotSource,
		portfolioId?: string
	): Promise<void> {
		for (const [key, row] of this.rows) {
			if (
				row.orgId === orgId &&
				row.clientProfileId === clientProfileId &&
				row.source === source &&
				(portfolioId === undefined || row.portfolioId === portfolioId)
			) {
				this.rows.delete(key);
			}
		}
	}

	async deleteClient(orgId: string, clientProfileId: string): Promise<void> {
		for (const [key, row] of this.rows) {
			if (row.orgId === orgId && row.clientProfileId === clientProfileId) {
				this.rows.delete(key);
			}
		}
	}

	async sumByDate(
		orgId: string,
		from: string,
		to: string,
		clientIds?: string[]
	): Promise<WealthDailySum[]> {
		const byDate = new Map<
			string,
			Omit<WealthDailySum, 'clients'> & { clientSet: Set<string> }
		>();
		for (const row of this.rows.values()) {
			if (
				row.orgId !== orgId ||
				row.date < from ||
				row.date > to ||
				!inClients(clientIds, row.clientProfileId)
			) {
				continue;
			}
			const day = byDate.get(row.date) ?? {
				date: row.date,
				totalMinor: 0,
				verifiedMinor: 0,
				manualMinor: 0,
				clientSet: new Set<string>(),
			};
			day.totalMinor += row.totalMinor;
			day.verifiedMinor += row.verifiedMinor;
			day.manualMinor += row.manualMinor;
			day.clientSet.add(row.clientProfileId);
			byDate.set(row.date, day);
		}
		return [...byDate.values()]
			.sort((a, b) => (a.date < b.date ? -1 : 1))
			.map(({ clientSet, ...rest }) => ({ ...rest, clients: clientSet.size }));
	}

	async clientIdsOn(
		orgId: string,
		date: string,
		clientIds?: string[]
	): Promise<string[]> {
		const ids = new Set<string>();
		for (const row of this.rows.values()) {
			if (
				row.orgId === orgId &&
				row.date === date &&
				inClients(clientIds, row.clientProfileId)
			) {
				ids.add(row.clientProfileId);
			}
		}
		return [...ids];
	}
}

const ACTIVE_ALERT_STATUSES: AlertStatus[] = [
	AlertStatus.Open,
	AlertStatus.Snoozed,
];

/** Campos que o `patch` nunca altera. */
const IMMUTABLE_ALERT_KEYS = [
	'id',
	'orgId',
	'clientProfileId',
	'conditionKey',
	'createdAt',
	'updatedAt',
] as const;

export class InMemoryAlertStore implements AlertStorePort {
	private readonly items = new Map<string, Alert>();
	private lastStampMs = 0;

	/** Relógio estritamente crescente: `createdAt` distintos como no Mongo. */
	private nextStamp(): Date {
		this.lastStampMs = Math.max(Date.now(), this.lastStampMs + 1);
		return new Date(this.lastStampMs);
	}

	private hasActive(a: NewAlert): boolean {
		return [...this.items.values()].some(
			(x) =>
				x.orgId === a.orgId &&
				x.clientProfileId === a.clientProfileId &&
				x.conditionKey === a.conditionKey &&
				ACTIVE_ALERT_STATUSES.includes(x.status)
		);
	}

	async insertMany(alerts: NewAlert[]): Promise<Alert[]> {
		const stored: Alert[] = [];
		for (const input of alerts) {
			if (
				ACTIVE_ALERT_STATUSES.includes(input.status) &&
				this.hasActive(input)
			) {
				continue;
			}
			const stamp = this.nextStamp();
			const alert: Alert = {
				...copy(input),
				id: randomUUID(),
				createdAt: stamp,
				updatedAt: stamp,
			};
			this.items.set(alert.id, alert);
			stored.push(copy(alert));
		}
		return stored;
	}

	async listForClient(
		orgId: string,
		clientProfileId: string,
		since: Date
	): Promise<Alert[]> {
		return [...this.items.values()]
			.filter(
				(a) =>
					a.orgId === orgId &&
					a.clientProfileId === clientProfileId &&
					(ACTIVE_ALERT_STATUSES.includes(a.status) ||
						a.updatedAt.getTime() >= since.getTime())
			)
			.sort(
				(a, b) =>
					a.createdAt.getTime() - b.createdAt.getTime() ||
					(a.id < b.id ? -1 : 1)
			)
			.map(copy);
	}

	async patch(
		id: string,
		patch: Partial<Alert>,
		expectedStatus?: AlertStatus[]
	): Promise<Alert | null> {
		const current = this.items.get(id);
		if (!current) return null;
		if (expectedStatus && !expectedStatus.includes(current.status)) {
			return null;
		}
		const next: Alert = { ...current };
		const target = next as unknown as Record<string, unknown>;
		for (const [key, value] of Object.entries(patch)) {
			if ((IMMUTABLE_ALERT_KEYS as readonly string[]).includes(key)) continue;
			if (value === undefined) delete target[key];
			else target[key] = copy(value);
		}
		next.updatedAt = new Date(
			Math.max(Date.now(), current.updatedAt.getTime() + 1)
		);
		this.items.set(id, next);
		return copy(next);
	}

	async resolveMany(ids: string[], at: Date): Promise<number> {
		let resolved = 0;
		for (const id of ids) {
			const current = this.items.get(id);
			if (!current || !ACTIVE_ALERT_STATUSES.includes(current.status)) {
				continue;
			}
			this.items.set(id, {
				...current,
				status: AlertStatus.Resolved,
				closedAt: at,
				updatedAt: new Date(
					Math.max(Date.now(), current.updatedAt.getTime() + 1)
				),
			});
			resolved += 1;
		}
		return resolved;
	}

	async findById(orgId: string, id: string): Promise<Alert | null> {
		const found = this.items.get(id);
		return found && found.orgId === orgId ? copy(found) : null;
	}

	private matching(orgId: string, q: AlertFilter): Alert[] {
		return [...this.items.values()]
			.filter(
				(a) =>
					a.orgId === orgId &&
					q.statuses.includes(a.status) &&
					inClients(q.clientIds, a.clientProfileId) &&
					(q.priorities === undefined || q.priorities.includes(a.priority)) &&
					(q.rules === undefined || q.rules.includes(a.rule))
			)
			.sort((a, b) => compareAlertCursor(alertCursorOf(a), alertCursorOf(b)));
	}

	async list(orgId: string, q: AlertListQuery): Promise<AlertPage> {
		const limit = clampAlertPageSize(q.limit);
		const after = q.cursor ? decodeAlertCursor(q.cursor) : null;
		const rest = this.matching(orgId, q).filter(
			(a) => !after || compareAlertCursor(alertCursorOf(a), after) > 0
		);
		const items = rest.slice(0, limit);
		const last = items[items.length - 1];
		return {
			items: items.map(copy),
			nextCursor:
				rest.length > limit && last
					? encodeAlertCursor(alertCursorOf(last))
					: null,
		};
	}

	async countOpenByPriority(
		orgId: string,
		clientIds?: string[]
	): Promise<OpenAlertCounts> {
		const counts: OpenAlertCounts = {
			[AlertPriority.P0]: 0,
			[AlertPriority.P1]: 0,
			[AlertPriority.P2]: 0,
			[AlertPriority.P3]: 0,
		};
		for (const a of this.matching(orgId, {
			statuses: [AlertStatus.Open],
			clientIds,
		})) {
			counts[a.priority] += 1;
		}
		return counts;
	}

	async listDeadlines(
		orgId: string,
		from: string,
		to: string,
		clientIds?: string[]
	): Promise<Alert[]> {
		const candidates = [...this.items.values()].filter(
			(a) => a.orgId === orgId && inClients(clientIds, a.clientProfileId)
		);
		return sortDeadlines(candidates, from, to).map(copy);
	}

	async idsByFilter(
		orgId: string,
		q: AlertFilter,
		max: number
	): Promise<string[]> {
		const cap = Math.min(
			Math.max(Math.trunc(max) || 0, 0),
			ALERT_IDS_BY_FILTER_MAX
		);
		return this.matching(orgId, q)
			.slice(0, cap)
			.map((a) => a.id);
	}

	async deleteByClient(orgId: string, clientProfileId: string): Promise<void> {
		for (const [id, a] of this.items) {
			if (a.orgId === orgId && a.clientProfileId === clientProfileId) {
				this.items.delete(id);
			}
		}
	}
}

export class InMemoryAlertSettingsStore implements AlertSettingsStorePort {
	private readonly items = new Map<string, StoredAlertSettings>();

	async find(orgId: string): Promise<StoredAlertSettings | null> {
		const found = this.items.get(orgId);
		return found ? copy(found) : null;
	}

	async upsertSettings(
		orgId: string,
		settings: AlertSettings,
		userId: string
	): Promise<StoredAlertSettings> {
		const current = this.items.get(orgId);
		const saved: StoredAlertSettings = {
			settings: copy(settings),
			engineEnabledAt: current?.engineEnabledAt ?? new Date(),
			updatedByUserId: userId,
			updatedAt: new Date(),
		};
		this.items.set(orgId, saved);
		return copy(saved);
	}

	async ensureEngineEnabled(orgId: string, at: Date): Promise<Date> {
		const current = this.items.get(orgId);
		if (current) return new Date(current.engineEnabledAt);
		this.items.set(orgId, {
			settings: copy(DEFAULT_ALERT_SETTINGS),
			engineEnabledAt: new Date(at),
		});
		return new Date(at);
	}
}

export class InMemoryClientContactStore implements ClientContactStorePort {
	private readonly items = new Map<string, { at: Date; userId: string }>();

	private key(orgId: string, clientProfileId: string): string {
		return JSON.stringify([orgId, clientProfileId]);
	}

	async record(
		orgId: string,
		clientProfileId: string,
		at: Date,
		userId: string
	): Promise<void> {
		const key = this.key(orgId, clientProfileId);
		const current = this.items.get(key);
		if (!current || at.getTime() > current.at.getTime()) {
			this.items.set(key, { at: new Date(at), userId });
		}
	}

	async find(orgId: string, clientProfileId: string): Promise<Date | null> {
		const found = this.items.get(this.key(orgId, clientProfileId));
		return found ? new Date(found.at) : null;
	}

	async deleteByClient(orgId: string, clientProfileId: string): Promise<void> {
		this.items.delete(this.key(orgId, clientProfileId));
	}
}

/** Gatilho que só anota os pedidos (`orgId:clientProfileId`). */
export class RecordingSnapshotTrigger implements ClientSnapshotTriggerPort {
	readonly requests: string[] = [];

	request(orgId: string, clientProfileId: string): void {
		this.requests.push(`${orgId}:${clientProfileId}`);
	}
}

/** Purga que só anota os pedidos; `failNext` faz a próxima lançar. */
export class RecordingAttentionPurge implements ClientAttentionPurgePort {
	readonly purged: string[] = [];
	private failures = 0;

	failNext(times = 1): void {
		this.failures = times;
	}

	async purgeClient(orgId: string, clientProfileId: string): Promise<void> {
		if (this.failures > 0) {
			this.failures -= 1;
			throw new Error('purge failed');
		}
		this.purged.push(`${orgId}:${clientProfileId}`);
	}
}
