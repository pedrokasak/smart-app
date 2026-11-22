import { ConflictException, NotFoundException } from '@nestjs/common';

/** O dono da organização não sai dela nem é removido por outro admin. */
export class OwnerCannotBeRemovedError extends ConflictException {
	constructor() {
		super({ reason: 'OWNER_CANNOT_BE_REMOVED' });
	}
}

export class OwnerCannotLeaveError extends ConflictException {
	constructor() {
		super({ reason: 'OWNER_CANNOT_LEAVE' });
	}
}

/** Usuário que não é membro da organização (ou já deixou de ser). */
export class MemberNotFoundError extends NotFoundException {
	constructor() {
		super('Member not found');
	}
}
