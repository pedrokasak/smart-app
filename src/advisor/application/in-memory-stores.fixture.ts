import { randomUUID } from 'crypto';
import {
	AdvisoryRelationship,
	ClientProfile,
	Membership,
	Organization,
} from '../domain/entities';
import { AssetClass, ProfileOrigin, RelationshipStatus } from '../domain/enums';
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
import { MembershipStorePort } from './ports/membership.store.port';
import { OrganizationStorePort } from './ports/organization.store.port';
import { DailyCloseMinor, PriceHistoryPort } from './ports/price-history.port';
import { RelationshipStorePort } from './ports/relationship.store.port';
import {
	DuplicateImportError,
	TransactionStorePort,
} from './ports/transaction.store.port';

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
	/** chave (org, cliente, hash) -> importBatchId */
	private readonly claims = new Map<string, string>();

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
		sourceHash: string
	): Promise<string> {
		const key = JSON.stringify([orgId, clientProfileId, sourceHash]);
		if (this.claims.has(key)) throw new DuplicateImportError();
		const batchId = randomUUID();
		this.claims.set(key, batchId);
		return batchId;
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
		for (const [key, batchId] of this.claims) {
			const [claimOrg, claimClient] = JSON.parse(key) as string[];
			if (
				batchId === importBatchId &&
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
