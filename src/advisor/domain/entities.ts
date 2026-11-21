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
	ownerUserId?: string;
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
	name: string;
	origin: ProfileOrigin;
	ownerUserId?: string;
}

/** Nome que fica no perfil de um cliente cuja conta foi excluída (LGPD). */
export const ERASED_CLIENT_NAME = 'Cliente excluído';
