import { canAccessClient } from './access-policy';
import { AdvisoryRelationship, Membership } from './entities';
import { OrgRole, ProfileOrigin, RelationshipStatus } from './enums';

const memOrgA: Membership = {
	id: 'm1',
	userId: 'u1',
	orgId: 'orgA',
	role: OrgRole.Advisor,
};
const adminOrgA: Membership = { ...memOrgA, id: 'm2', role: OrgRole.OrgAdmin };
const activeOrgA: AdvisoryRelationship = {
	id: 'r1',
	orgId: 'orgA',
	clientProfileId: 'c1',
	status: RelationshipStatus.Active,
};
const relOrgB: AdvisoryRelationship = {
	...activeOrgA,
	id: 'r2',
	orgId: 'orgB',
};
const revokedOrgA: AdvisoryRelationship = {
	...activeOrgA,
	id: 'r3',
	status: RelationshipStatus.Revoked,
};
const pendingOrgA: AdvisoryRelationship = {
	...activeOrgA,
	id: 'r4',
	status: RelationshipStatus.Pending,
};

const ADV = ProfileOrigin.AdvisorCreated;
const CLI = ProfileOrigin.ClientCreated;

describe('canAccessClient', () => {
	it('denies without membership', () => {
		expect(
			canAccessClient({
				relationship: activeOrgA,
				profileOrigin: ADV,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('NOT_ACCESSIBLE');
	});

	it('denies without relationship', () => {
		expect(
			canAccessClient({
				membership: memOrgA,
				profileOrigin: ADV,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('NOT_ACCESSIBLE');
	});

	it('denies when membership.orgId differs from relationship.orgId', () => {
		expect(
			canAccessClient({
				membership: memOrgA,
				relationship: relOrgB,
				profileOrigin: ADV,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('NOT_ACCESSIBLE');
	});

	it('denies revoked relationship', () => {
		expect(
			canAccessClient({
				membership: memOrgA,
				relationship: revokedOrgA,
				profileOrigin: ADV,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('NOT_ACCESSIBLE');
	});

	it('denies pending relationship', () => {
		expect(
			canAccessClient({
				membership: memOrgA,
				relationship: pendingOrgA,
				profileOrigin: ADV,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('NOT_ACCESSIBLE');
	});

	it('denies membership with an unknown role', () => {
		expect(
			canAccessClient({
				membership: { ...memOrgA, role: 'OWNER' as OrgRole },
				relationship: activeOrgA,
				profileOrigin: ADV,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('NOT_ACCESSIBLE');
	});

	it('allows advisor in same org with active relationship', () => {
		expect(
			canAccessClient({
				membership: memOrgA,
				relationship: activeOrgA,
				assigned: true,
				profileOrigin: ADV,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('ALLOWED');
	});

	it('refuses PUBLISH_REPORT even for an org admin with active relationship', () => {
		expect(
			canAccessClient({
				membership: adminOrgA,
				relationship: activeOrgA,
				profileOrigin: ADV,
				action: 'PUBLISH_REPORT',
			})
		).toBe('ACTION_FORBIDDEN');
	});

	it('denies a known role without a profile', () => {
		expect(
			canAccessClient({
				membership: memOrgA,
				relationship: activeOrgA,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('NOT_ACCESSIBLE');
	});

	it('allows VIEW_PORTFOLIO on a CLIENT_CREATED profile', () => {
		expect(
			canAccessClient({
				membership: memOrgA,
				relationship: activeOrgA,
				assigned: true,
				profileOrigin: CLI,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('ALLOWED');
	});

	it('forbids EDIT_POSITION on a CLIENT_CREATED profile', () => {
		expect(
			canAccessClient({
				membership: memOrgA,
				relationship: activeOrgA,
				assigned: true,
				profileOrigin: CLI,
				action: 'EDIT_POSITION',
			})
		).toBe('ACTION_FORBIDDEN');
	});

	it('allows EDIT_POSITION on an ADVISOR_CREATED profile', () => {
		expect(
			canAccessClient({
				membership: memOrgA,
				relationship: activeOrgA,
				assigned: true,
				profileOrigin: ADV,
				action: 'EDIT_POSITION',
			})
		).toBe('ALLOWED');
	});

	it.each([ADV, CLI])('forbids PUBLISH_REPORT on %s profile', (origin) => {
		expect(
			canAccessClient({
				membership: memOrgA,
				relationship: activeOrgA,
				assigned: true,
				profileOrigin: origin,
				action: 'PUBLISH_REPORT',
			})
		).toBe('ACTION_FORBIDDEN');
	});

	it('reports NOT_ACCESSIBLE before ACTION_FORBIDDEN', () => {
		expect(
			canAccessClient({
				membership: memOrgA,
				relationship: revokedOrgA,
				profileOrigin: CLI,
				action: 'PUBLISH_REPORT',
			})
		).toBe('NOT_ACCESSIBLE');
	});

	it('denies an ADVISOR when the client is not assigned', () => {
		expect(
			canAccessClient({
				membership: memOrgA,
				relationship: activeOrgA,
				profileOrigin: ADV,
				assigned: false,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('NOT_ACCESSIBLE');
	});

	it('denies an ADVISOR when assigned is absent', () => {
		expect(
			canAccessClient({
				membership: memOrgA,
				relationship: activeOrgA,
				profileOrigin: ADV,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('NOT_ACCESSIBLE');
	});

	it('allows an ORG_ADMIN regardless of assignment', () => {
		expect(
			canAccessClient({
				membership: adminOrgA,
				relationship: activeOrgA,
				profileOrigin: ADV,
				assigned: false,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('ALLOWED');
	});

	it('allows an ORG_ADMIN to VIEW_PORTFOLIO without assigned', () => {
		expect(
			canAccessClient({
				membership: adminOrgA,
				relationship: activeOrgA,
				profileOrigin: CLI,
				action: 'VIEW_PORTFOLIO',
			})
		).toBe('ALLOWED');
	});

	it('still forbids EDIT_POSITION on CLIENT_CREATED for an ORG_ADMIN', () => {
		expect(
			canAccessClient({
				membership: adminOrgA,
				relationship: activeOrgA,
				profileOrigin: CLI,
				action: 'EDIT_POSITION',
			})
		).toBe('ACTION_FORBIDDEN');
	});
});
