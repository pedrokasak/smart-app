import { randomUUID } from 'crypto';
import { ClientInvite, Consent } from '../domain/consent.entities';
import {
	AdvisoryRelationship,
	ClientProfile,
	Membership,
	Organization,
} from '../domain/entities';
import {
	AssetClass,
	ConsentStatus,
	ImportBatchStatus,
	InviteStatus,
	ProfileOrigin,
	RelationshipStatus,
} from '../domain/enums';
import {
	AllocationTarget,
	NewTransaction,
	Transaction,
} from '../domain/portfolio.entities';
import { AllocationTargetStorePort } from './ports/allocation-target.store.port';
import {
	BenchmarkKey,
	BenchmarkSeriesPort,
} from './ports/benchmark-series.port';
import { ClientProfileStorePort } from './ports/client-profile.store.port';
import { ConsentStorePort } from './ports/consent.store.port';
import { InviteStorePort } from './ports/invite.store.port';
import { MembershipStorePort } from './ports/membership.store.port';
import { OrganizationStorePort } from './ports/organization.store.port';
import { DailyCloseMinor, PriceHistoryPort } from './ports/price-history.port';
import { RelationshipStorePort } from './ports/relationship.store.port';
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
		const created: Organization = { ...org, id: randomUUID() };
		this.items.set(created.id, created);
		return created;
	}

	async findById(id: string): Promise<Organization | null> {
		return this.items.get(id) ?? null;
	}
}

export class InMemoryMembershipStore implements MembershipStorePort {
	private readonly items = new Map<string, Membership>();

	async create(membership: Omit<Membership, 'id'>): Promise<Membership> {
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
}

export class InMemoryRelationshipStore implements RelationshipStorePort {
	private readonly items = new Map<string, AdvisoryRelationship>();

	async create(
		relationship: Omit<AdvisoryRelationship, 'id'>
	): Promise<AdvisoryRelationship> {
		const created: AdvisoryRelationship = { ...relationship, id: randomUUID() };
		this.items.set(created.id, created);
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
}

export class InMemoryClientProfileStore implements ClientProfileStorePort {
	private readonly items = new Map<string, ClientProfile>();

	async create(profile: Omit<ClientProfile, 'id'>): Promise<ClientProfile> {
		const created: ClientProfile = { ...profile, id: randomUUID() };
		this.items.set(created.id, created);
		return created;
	}

	async findById(id: string): Promise<ClientProfile | null> {
		return this.items.get(id) ?? null;
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
}

export class InMemoryConsentStore implements ConsentStorePort {
	private readonly items = new Map<string, Consent>();

	/** Tudo síncrono antes de qualquer await: dois grants não se intercalam. */
	async grant(
		consent: Omit<Consent, 'id' | 'version' | 'status' | 'endedAt'>
	): Promise<Consent> {
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
