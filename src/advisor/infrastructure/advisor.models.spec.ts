import { advisorSchemas } from './advisor.models';

type IndexEntry = [Record<string, number>, Record<string, unknown>];

function findIndex(
	indexes: IndexEntry[],
	fields: Record<string, number>
): IndexEntry | undefined {
	return indexes.find(
		([spec]) => JSON.stringify(spec) === JSON.stringify(fields)
	);
}

describe('advisor schemas', () => {
	it('uses the expected collection names', () => {
		expect(advisorSchemas.organization.get('collection')).toBe(
			'advisor_organizations'
		);
		expect(advisorSchemas.membership.get('collection')).toBe(
			'advisor_memberships'
		);
		expect(advisorSchemas.relationship.get('collection')).toBe(
			'advisor_relationships'
		);
		expect(advisorSchemas.clientProfile.get('collection')).toBe(
			'advisor_client_profiles'
		);
	});

	it('membership has a unique index on userId + orgId', () => {
		const index = findIndex(
			advisorSchemas.membership.indexes() as IndexEntry[],
			{
				userId: 1,
				orgId: 1,
			}
		);
		expect(index).toBeDefined();
		expect(index?.[1].unique).toBe(true);
	});

	it('relationship has a unique partial index (ACTIVE only) on orgId + clientProfileId', () => {
		const index = findIndex(
			advisorSchemas.relationship.indexes() as IndexEntry[],
			{ orgId: 1, clientProfileId: 1 }
		);
		expect(index).toBeDefined();
		expect(index?.[1].unique).toBe(true);
		expect(index?.[1].partialFilterExpression).toEqual({ status: 'ACTIVE' });
	});
});
