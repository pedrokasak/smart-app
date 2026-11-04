import { canAccessClient } from './access-policy';
import {
  AdvisoryRelationship,
  Membership,
} from './entities';
import { OrgRole, RelationshipStatus } from './enums';

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
const relOrgB: AdvisoryRelationship = { ...activeOrgA, id: 'r2', orgId: 'orgB' };
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

describe('canAccessClient', () => {
  it('denies without membership', () => {
    expect(
      canAccessClient({ relationship: activeOrgA, action: 'VIEW_PORTFOLIO' }),
    ).toBe(false);
  });

  it('denies without relationship', () => {
    expect(
      canAccessClient({ membership: memOrgA, action: 'VIEW_PORTFOLIO' }),
    ).toBe(false);
  });

  it('denies when membership.orgId differs from relationship.orgId', () => {
    expect(
      canAccessClient({
        membership: memOrgA,
        relationship: relOrgB,
        action: 'VIEW_PORTFOLIO',
      }),
    ).toBe(false);
  });

  it('denies revoked relationship', () => {
    expect(
      canAccessClient({
        membership: memOrgA,
        relationship: revokedOrgA,
        action: 'VIEW_PORTFOLIO',
      }),
    ).toBe(false);
  });

  it('denies pending relationship', () => {
    expect(
      canAccessClient({
        membership: memOrgA,
        relationship: pendingOrgA,
        action: 'VIEW_PORTFOLIO',
      }),
    ).toBe(false);
  });

  it('denies membership with an unknown role', () => {
    expect(
      canAccessClient({
        membership: { ...memOrgA, role: 'OWNER' as OrgRole },
        relationship: activeOrgA,
        action: 'VIEW_PORTFOLIO',
      }),
    ).toBe(false);
  });

  it('allows advisor in same org with active relationship', () => {
    expect(
      canAccessClient({
        membership: memOrgA,
        relationship: activeOrgA,
        action: 'VIEW_PORTFOLIO',
      }),
    ).toBe(true);
  });

  it('allows org admin in same org with active relationship', () => {
    expect(
      canAccessClient({
        membership: adminOrgA,
        relationship: activeOrgA,
        action: 'PUBLISH_REPORT',
      }),
    ).toBe(true);
  });
});
