/** Já existe uma organização cujo dono é este usuário (uma por dono). */
export class DuplicateOrganizationOwnerError extends Error {
	constructor() {
		super('Organization already exists for this owner');
		this.name = 'DuplicateOrganizationOwnerError';
	}
}

/** O usuário já é membro desta organização. */
export class DuplicateMembershipError extends Error {
	constructor() {
		super('Membership already exists for this user and organization');
		this.name = 'DuplicateMembershipError';
	}
}

/** O cursor de paginação não é um cursor emitido por este store. */
export class InvalidCursorError extends Error {
	constructor() {
		super('Invalid pagination cursor');
		this.name = 'InvalidCursorError';
	}
}
