export enum OrgRole {
  OrgAdmin = 'ORG_ADMIN',
  Advisor = 'ADVISOR',
}

export enum AdvisorType {
  Assessor = 'ASSESSOR',
  Consultor = 'CONSULTOR',
}

export enum ProfileOrigin {
  AdvisorCreated = 'ADVISOR_CREATED',
  ClientCreated = 'CLIENT_CREATED',
}

export enum RelationshipStatus {
  Active = 'ACTIVE',
  Pending = 'PENDING',
  Revoked = 'REVOKED',
}

export type ClientAction = 'VIEW_PORTFOLIO' | 'PUBLISH_REPORT' | 'EDIT_POSITION';
