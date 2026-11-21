import { InternalServerErrorException } from '@nestjs/common';
import { requesterIdOf } from 'src/auth/ownership';
import type { AccessContext } from 'src/advisor/application/authorization.service';
import type { OrgContext } from 'src/advisor/interface/org-context.guard';

/**
 * Contexto de acesso da requisição: o usuário vem do JWT e a org ativa de
 * `req.orgContext` (preenchido pelo `OrgContextGuard`). Rota que lê o
 * contexto sem o guard é erro de wiring, não de quem chamou: 500.
 */
export function accessContextOf(req: any): AccessContext {
	const orgContext: OrgContext | undefined = req?.orgContext;
	if (!orgContext?.orgId) {
		throw new InternalServerErrorException(
			'OrgContextGuard is missing on this route'
		);
	}
	return { userId: requesterIdOf(req), orgId: orgContext.orgId };
}
