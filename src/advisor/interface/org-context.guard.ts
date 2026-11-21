import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from '@nestjs/common';
import { requesterIdOf } from 'src/auth/ownership';
import { MembershipService } from '../application/membership.service';
import { OrgRole } from '../domain/enums';

/** Org ativa da requisicao, anexada em `req.orgContext` pelo guard. */
export interface OrgContext {
	orgId: string;
	role: OrgRole;
}

const ORG_HEADER = 'x-org-id';

/**
 * Resolve a org ativa a partir do header `x-org-id` (nunca de claim do JWT).
 * Sem header, usa o primeiro vinculo. Com header, so vale se o usuario for
 * membro: caso contrario, 403, sem cair em outra org.
 */
@Injectable()
export class OrgContextGuard implements CanActivate {
	constructor(private readonly memberships: MembershipService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const req = context.switchToHttp().getRequest();
		const userId = requesterIdOf(req);
		const requested = this.requestedOrgId(req);

		const membership = await this.memberships.resolveActiveOrg(
			userId,
			requested
		);

		const orgContext: OrgContext = {
			orgId: membership.orgId,
			role: membership.role,
		};
		req.orgContext = orgContext;
		return true;
	}

	private requestedOrgId(req: any): string | undefined {
		const raw = req?.headers?.[ORG_HEADER];
		if (raw === undefined) return undefined;
		if (typeof raw !== 'string') {
			throw new ForbiddenException('Invalid organization header');
		}
		return raw.trim() || undefined;
	}
}
