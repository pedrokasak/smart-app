import { SetMetadata } from '@nestjs/common';
import { PlanCapability } from 'src/subscription/application/user-plan.types';

export const REQUIRED_CAPABILITY_KEY = 'plan:required-capability';

/**
 * Sentinela de `@PlanFree()`. Não é uma capability: é a declaração explícita
 * de que a rota não exige plano, e existe para sobrescrever um
 * `@RequiresCapability` posto na classe.
 */
export const PLAN_FREE = false as const;

export type RequiredCapabilityMetadata = PlanCapability | typeof PLAN_FREE;

/**
 * Gate declarativo de plano (TRA-193).
 *
 * Em vez de cada service fazer `if (!planHasCapability(...)) throw`, a rota
 * declara o que exige e o `PlanCapabilityGuard` global decide:
 *
 *   @RequiresCapability('fiscal.darf')     // vale para todas as rotas
 *   @Controller('fiscal')
 *   export class FiscalController {
 *     @RequiresCapability('fiscal.ir_report')  // sobrescreve a da classe
 *     @Get('ir-report') ...
 *   }
 *
 * Mudar QUAL PLANO tem a capability é dado — checkbox no painel admin. Mudar
 * QUAL CAPABILITY uma rota exige é trocar o decorator. Nenhum dos dois pede
 * caçar `if` em service.
 */
export const RequiresCapability = (capability: PlanCapability) =>
	SetMetadata(REQUIRED_CAPABILITY_KEY, capability);

/** Rota liberada em qualquer plano, mesmo dentro de classe gateada. */
export const PlanFree = () => SetMetadata(REQUIRED_CAPABILITY_KEY, PLAN_FREE);
