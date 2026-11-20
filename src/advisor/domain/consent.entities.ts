import { ConsentStatus, InviteStatus } from './enums';

export interface ClientInvite {
	id: string;
	orgId: string;
	clientProfileId: string;
	relationshipId: string;
	email: string; // normalized
	tokenHash: string; // sha-256 hex
	status: InviteStatus;
	expiresAt: Date;
	resendCount: number;
	invitedByUserId: string;
	createdAt: Date;
	respondedAt?: Date;
}

export interface Consent {
	id: string;
	orgId: string;
	clientProfileId: string;
	relationshipId: string;
	userId: string; // investor
	portfolioIds: string[]; // opaque B2C portfolio ids
	version: number; // 1, 2, 3... per relationship
	textVersion: string; // version of the consent text shown
	status: ConsentStatus;
	grantedAt: Date;
	endedAt?: Date;
}
