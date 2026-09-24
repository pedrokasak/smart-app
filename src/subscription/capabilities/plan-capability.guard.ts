import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Inject,
	Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
	PlanCapability,
	planHasCapability,
	USER_PLAN_RESOLVER,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';
import {
	PLAN_FREE,
	REQUIRED_CAPABILITY_KEY,
	RequiredCapabilityMetadata,
} from './requires-capability.decorator';

/**
 * Mensagem mantida de propósito: o web já reconhece `PLANO_UPGRADE_NECESSARIO`
 * para mostrar o upsell (`useBrokerSync`). O código novo e a capability vão em
 * campos próprios, sem quebrar quem lê só a mensagem.
 */
export const PLAN_UPGRADE_MESSAGE = 'PLANO_UPGRADE_NECESSARIO';
export const PLAN_CAPABILITY_ERROR = 'PLAN_CAPABILITY_REQUIRED';

export function planCapabilityDenied(
	capability: PlanCapability
): ForbiddenException {
	return new ForbiddenException({
		statusCode: 403,
		error: PLAN_CAPABILITY_ERROR,
		message: PLAN_UPGRADE_MESSAGE,
		capability,
	});
}

/**
 * Aplica `@RequiresCapability` (TRA-193). Registrado como `APP_GUARD` DEPOIS
 * do `JwtAuthGuard`, então quando roda o usuário já foi autenticado.
 *
 * Fonte única do plano: `USER_PLAN_RESOLVER`. Os gates antigos resolviam a
 * assinatura cada um do seu jeito (TRA-83); aqui não existe outro caminho.
 *
 * Falha fechada em todos os casos de dúvida: rota gateada sem usuário no
 * request, ou resolver que não consegue ler o plano (ele próprio devolve o
 * nível gratuito quando a consulta falha).
 */
@Injectable()
export class PlanCapabilityGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		@Inject(USER_PLAN_RESOLVER)
		private readonly userPlanResolver: UserPlanResolverPort
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const required =
			this.reflector.getAllAndOverride<RequiredCapabilityMetadata>(
				REQUIRED_CAPABILITY_KEY,
				[context.getHandler(), context.getClass()]
			);
		if (required === undefined || required === PLAN_FREE) return true;

		const request = context.switchToHttp().getRequest();
		const userId = String(request?.user?.userId ?? request?.user?.sub ?? '');
		if (!userId) throw planCapabilityDenied(required);

		const access = await this.userPlanResolver.resolveWithCapabilities(userId);
		if (
			planHasCapability(
				access.capabilities,
				required,
				access.tier,
				access.capabilitiesKnown
			)
		) {
			return true;
		}

		throw planCapabilityDenied(required);
	}
}
