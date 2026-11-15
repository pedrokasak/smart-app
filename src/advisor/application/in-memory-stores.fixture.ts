import { randomUUID } from 'crypto';
import {
	AdvisoryRelationship,
	ClientProfile,
	Membership,
	Organization,
} from '../domain/entities';
import { ProfileOrigin, RelationshipStatus } from '../domain/enums';
import { ClientProfileStorePort } from './ports/client-profile.store.port';
import { MembershipStorePort } from './ports/membership.store.port';
import { OrganizationStorePort } from './ports/organization.store.port';
import { RelationshipStorePort } from './ports/relationship.store.port';

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
