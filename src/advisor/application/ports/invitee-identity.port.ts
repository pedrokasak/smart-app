export const ADVISOR_INVITEE_IDENTITY = Symbol('ADVISOR_INVITEE_IDENTITY');

export interface InviteeAccount {
	email: string;
	emailVerified: boolean;
}

export interface InviteeIdentityPort {
	/** Conta do investidor. Null se não existe. */
	find(userId: string): Promise<InviteeAccount | null>;

	/**
	 * Marks the account e-mail as verified, but only while the account still
	 * holds `email` (a change of e-mail meanwhile confirms nothing).
	 */
	markEmailVerified(userId: string, email: string): Promise<void>;
}
