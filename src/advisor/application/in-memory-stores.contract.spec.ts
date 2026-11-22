import {
	InMemoryAllocationTargetStore,
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
	InMemoryConsentStore,
	InMemoryInviteStore,
	InMemoryMemberInviteStore,
	InMemoryMembershipStore,
	InMemoryOrganizationStore,
	InMemoryPortalGrantStore,
	InMemoryRelationshipStore,
	InMemoryTransactionStore,
} from './in-memory-stores.fixture';
import {
	describeAdvisorConsentStoreContract,
	describeAdvisorPortalGrantStoreContract,
	describeAdvisorPortfolioStoreContract,
	describeAdvisorStoreContract,
	describeAdvisorTeamStoreContract,
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

describeAdvisorPortalGrantStoreContract(
	'in-memory',
	() => new InMemoryPortalGrantStore()
);

describeAdvisorTeamStoreContract('in-memory', () => {
	const assignments = new InMemoryAssignmentStore();
	return {
		assignments,
		memberInvites: new InMemoryMemberInviteStore(),
		memberships: new InMemoryMembershipStore(),
		relationships: new InMemoryRelationshipStore(assignments),
		profiles: new InMemoryClientProfileStore(),
	};
});
