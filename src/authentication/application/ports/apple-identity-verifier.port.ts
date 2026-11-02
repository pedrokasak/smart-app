export const APPLE_IDENTITY_VERIFIER = Symbol('APPLE_IDENTITY_VERIFIER');

/** O que um token da Apple já validado prova sobre a pessoa. */
export interface AppleIdentity {
	/** Identificador estável da pessoa. A Apple sempre o envia. */
	sub: string;
	/** A Apple pode omitir o e-mail depois do primeiro login. */
	email?: string;
	emailVerified: boolean;
}

export interface AppleIdentityVerifier {
	/** Lança `UnauthorizedException` se o token não for válido para este app. */
	verify(identityToken: string, nonce?: string): Promise<AppleIdentity>;
}
