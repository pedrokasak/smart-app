import { MemberInviteStatus, OrgRole } from './enums';

export interface MemberInvite {
	id: string;
	orgId: string;
	email: string;
	/** Papel concedido ao aceitar; convite de membro é sempre ADVISOR. */
	role: OrgRole;
	tokenHash: string;
	status: MemberInviteStatus;
	expiresAt: Date;
	resendCount: number;
	invitedByUserId: string;
	createdAt: Date;
	respondedAt?: Date;
}

export interface ClientAssignment {
	id: string;
	orgId: string;
	clientProfileId: string;
	userId: string;
	assignedBy: string;
	createdAt: Date;
}
