import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * Motivos de 409 do convite de membro. `NOT_PENDING` é o mesmo do convite de
 * cliente (P3a): reenviar ou cancelar convite que já saiu de PENDING.
 */
export type MemberInviteConflictReason =
	| 'ALREADY_MEMBER'
	| 'PENDING_INVITE'
	| 'RESEND_LIMIT'
	| 'NOT_PENDING';

/** O filtro do BFF devolve 409 com este `reason`. */
export class MemberInviteConflictError extends ConflictException {
	constructor(reason: MemberInviteConflictReason) {
		super({ reason });
	}
}

/**
 * Mesmo 404 para todo token que não serve (inválido, vencido, usado, de outro
 * e-mail) e para convite de outra organização: nada diz por que falhou.
 */
export class MemberInviteNotFoundError extends NotFoundException {
	constructor() {
		super('Invite not found');
	}
}
