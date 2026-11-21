import { ForbiddenException } from '@nestjs/common';

/** Cliente fora do alcance do ator (sem vínculo, outra org, sem perfil). */
export class ClientNotAccessibleError extends ForbiddenException {
	readonly reason = 'CLIENT_NOT_ACCESSIBLE' as const;

	constructor() {
		super('Access to this client is not allowed');
	}
}

/** Cliente acessível, mas a ação não é permitida para a origem do perfil. */
export class ClientActionForbiddenError extends ForbiddenException {
	readonly reason = 'ACTION_FORBIDDEN' as const;

	constructor() {
		super('This action is not allowed for this client');
	}
}
