import {
	AdvisorType,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
} from '../domain/enums';
import {
	toClientProfile,
	toMembership,
	toOrganization,
	toRelationship,
} from './advisor.mappers';

const now = new Date('2026-01-01T00:00:00Z');

describe('advisor doc to entity mappers', () => {
	it('organization: maps _id to id and drops internals', () => {
		const doc = {
			_id: 'o1',
			name: 'Acme',
			advisorType: AdvisorType.Consultor,
			plan: 'pro',
			createdAt: now,
			updatedAt: now,
			__v: 0,
		};
		const result = toOrganization(doc);
		expect(result).toEqual({
			id: 'o1',
			name: 'Acme',
			advisorType: AdvisorType.Consultor,
			plan: 'pro',
		});
		expect(Object.keys(result)).not.toContain('_id');
		expect(Object.keys(result)).not.toContain('createdAt');
		expect(Object.keys(result)).not.toContain('__v');
	});

	it('organization: omits absent optional plan', () => {
		const result = toOrganization({
			_id: 'o1',
			name: 'Acme',
			advisorType: AdvisorType.Assessor,
			plan: null,
			createdAt: now,
			updatedAt: now,
		});
		expect('plan' in result).toBe(false);
	});

	it('membership: maps fields', () => {
		expect(
			toMembership({
				_id: 'm1',
				userId: 'u1',
				orgId: 'o1',
				role: OrgRole.Advisor,
				createdAt: now,
				updatedAt: now,
			})
		).toEqual({ id: 'm1', userId: 'u1', orgId: 'o1', role: OrgRole.Advisor });
	});

	it('relationship: maps optional consentId and scope only when present', () => {
		const full = toRelationship({
			_id: 'r1',
			orgId: 'o1',
			clientProfileId: 'c1',
			status: RelationshipStatus.Active,
			consentId: 'k1',
			scope: ['VIEW_PORTFOLIO'],
			createdAt: now,
			updatedAt: now,
		});
		expect(full).toEqual({
			id: 'r1',
			orgId: 'o1',
			clientProfileId: 'c1',
			status: RelationshipStatus.Active,
			consentId: 'k1',
			scope: ['VIEW_PORTFOLIO'],
		});
		const bare = toRelationship({
			_id: 'r2',
			orgId: 'o1',
			clientProfileId: 'c1',
			status: RelationshipStatus.Pending,
			createdAt: now,
			updatedAt: now,
		});
		expect('consentId' in bare).toBe(false);
		expect('scope' in bare).toBe(false);
	});

	it('client profile: maps name, origin and optional owner', () => {
		const claimed = toClientProfile({
			_id: 'c1',
			orgId: 'o1',
			name: 'João',
			origin: ProfileOrigin.ClientCreated,
			ownerUserId: 'u1',
			createdAt: now,
			updatedAt: now,
		});
		expect(claimed).toEqual({
			id: 'c1',
			orgId: 'o1',
			name: 'João',
			origin: ProfileOrigin.ClientCreated,
			ownerUserId: 'u1',
		});
		const unowned = toClientProfile({
			_id: 'c2',
			orgId: 'o1',
			name: 'Ana',
			origin: ProfileOrigin.AdvisorCreated,
			createdAt: now,
			updatedAt: now,
		});
		expect('ownerUserId' in unowned).toBe(false);
	});
});
