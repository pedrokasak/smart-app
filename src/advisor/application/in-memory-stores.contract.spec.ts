import {
	InMemoryAllocationTargetStore,
	InMemoryClientProfileStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryRelationshipStore,
	InMemoryTransactionStore,
} from './in-memory-stores.fixture';
import {
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
