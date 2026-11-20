export const ADVISOR_INVITEE_IDENTITY = Symbol('ADVISOR_INVITEE_IDENTITY');

export interface InviteeAccount {
	email: string;
	emailVerified: boolean;
}

export interface InviteeIdentityPort {
	/** Conta do investidor. Null se não existe. */
	find(userId: string): Promise<InviteeAccount | null>;
}
