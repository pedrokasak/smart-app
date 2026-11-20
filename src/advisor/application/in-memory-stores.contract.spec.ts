import {
	InMemoryAllocationTargetStore,
	InMemoryClientProfileStore,
	InMemoryConsentStore,
	InMemoryInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryRelationshipStore,
	InMemoryTransactionStore,
} from './in-memory-stores.fixture';
import {
	describeAdvisorConsentStoreContract,
	describeAdvisorPortfolioStoreContract,
	describeAdvisorStoreContract,
} from './store-contract.fixture';

describeAdvisorStoreContract('in-memory', () => ({
	orgs: new InMemoryOrganizationStore(),
	memberships: new InMemoryMembershipStore(),
	relationships: new InMemoryRelationshipStore(),
	profiles: new InMemoryClientProfileStore(),
}));

describeAdvisorPortfolioStoreContract('in-memory', () => ({
	transactions: new InMemoryTransactionStore(),
	targets: new InMemoryAllocationTargetStore(),
}));

describeAdvisorConsentStoreContract('in-memory', () => ({
	invites: new InMemoryInviteStore(),
	consents: new InMemoryConsentStore(),
}));
