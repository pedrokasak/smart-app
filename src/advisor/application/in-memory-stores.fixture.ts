import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ClientInvite, Consent } from '../domain/consent.entities';
import {
	AdvisoryRelationship,
	ClientProfile,
	ERASED_CLIENT_NAME,
	Membership,
	Organization,
} from '../domain/entities';
import {
	AssetClass,
	ConsentStatus,
	ImportBatchStatus,
	InviteStatus,
	MemberInviteStatus,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
} from '../domain/enums';
import {
	AllocationTarget,
	NewTransaction,
	Transaction,
} from '../domain/portfolio.entities';
import { PortalGrant } from '../domain/portal-access';
import { ClientAssignment, MemberInvite } from '../domain/team.entities';
import { AllocationTargetStorePort } from './ports/allocation-target.store.port';
import {
	AssignedClientsPage,
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
}

export class InMemoryMembershipStore implements MembershipStorePort {
	private readonly items = new Map<string, Membership>();

	async create(membership: Omit<Membership, 'id'>): Promise<Membership> {
		if (
			[...this.items.values()].some(
				(m) => m.userId === membership.userId && m.orgId === membership.orgId
			)
		) {
			throw new DuplicateMembershipError();
		}
		const created: Membership = { ...membership, id: randomUUID() };
		this.items.set(created.id, created);
		return created;
	}

	async findByUser(userId: string): Promise<Membership[]> {
		return [...this.items.values()].filter((m) => m.userId === userId);
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
		// Map preserva a ordem de criação.
		return [...this.items.values()]
			.filter((m) => m.orgId === orgId)
			.slice(0, 200)
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
	 * Fonte das atribuições para `listUnassignedByOrg`; sem ela, todo perfil
	 * conta como não atribuído.
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
		const assigned = new Set<string>();
		for (const r of this.items.values()) {
			if (r.orgId !== orgId) continue;
			const rows = await this.assignments?.listByClient(
				orgId,
				r.clientProfileId
			);
			if (rows && rows.length > 0) assigned.add(r.clientProfileId);
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

	private active(userId: string): PortalGrant | undefined {
		return this.grants.find((g) => g.userId === userId && !g.revokedAt);
	}
}

/** Contas B2C em memória para a liberação do portal, por userId. */
export class InMemoryPortalAccountDirectory implements PortalAccountDirectoryPort {
	private readonly emails = new Map<string, string>();

	set(userId: string, email: string): void {
		this.emails.set(userId, email);
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
}

export class InMemoryAssignmentStore implements AssignmentStorePort {
	private readonly items = new Map<string, ClientAssignment>();
	private lastCreatedAtMs = 0;

	async assign(
		orgId: string,
		clientProfileId: string,
		userId: string,
		assignedBy: string
	): Promise<ClientAssignment> {
		const existing = this.find(orgId, clientProfileId, userId);
		if (existing) return { ...existing };
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
		return { ...created };
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
		this.items.set(id, updated);
		return { ...updated };
	}

	async rotateToken(
		id: string,
		tokenHash: string,
		expiresAt: Date
	): Promise<MemberInvite | null> {
		const current = this.items.get(id);
		if (!current || current.status !== MemberInviteStatus.Pending) {
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

	async deletePendingByEmail(email: string): Promise<number> {
		let removed = 0;
		for (const [id, invite] of this.items) {
			if (
				invite.email === email &&
				invite.status === MemberInviteStatus.Pending
			) {
				this.items.delete(id);
				removed += 1;
			}
		}
		return removed;
	}
}
