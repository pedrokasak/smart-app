import {
	InMemoryClientProfileStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryRelationshipStore,
} from './in-memory-stores.fixture';
import { describeAdvisorStoreContract } from './store-contract.fixture';

describeAdvisorStoreContract('in-memory', () => ({
	orgs: new InMemoryOrganizationStore(),
	memberships: new InMemoryMembershipStore(),
	relationships: new InMemoryRelationshipStore(),
	profiles: new InMemoryClientProfileStore(),
}));
