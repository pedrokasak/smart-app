import {
  AdvisorType,
  OrgRole,
  ProfileOrigin,
  RelationshipStatus,
} from './enums';

export interface Organization {
  id: string;
  name: string;
  advisorType: AdvisorType;
  plan?: string;
}

export interface Membership {
  id: string;
  userId: string;
  orgId: string;
  role: OrgRole;
}

export interface AdvisoryRelationship {
  id: string;
  orgId: string;
  clientProfileId: string;
  status: RelationshipStatus;
  consentId?: string;
  scope?: string[];
}

export interface ClientProfile {
  id: string;
  orgId: string;
  origin: ProfileOrigin;
  ownerUserId?: string;
}
