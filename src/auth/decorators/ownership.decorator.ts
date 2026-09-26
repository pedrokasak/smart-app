import { SetMetadata } from '@nestjs/common';

export const OWNERSHIP_KEY = 'ownership';

export interface OwnershipDeclaration {
	scope: 'user' | 'global';
	how: string;
}

/**
 * Toda rota com id na URL precisa dizer como garante que o recurso é de
 * quem chama (TRA-220). O teste de contrato
 * (`ownership.contract.spec.ts`) falha se uma rota nova esquecer.
 */
export const OwnershipChecked = (how: string) =>
	SetMetadata<string, OwnershipDeclaration>(OWNERSHIP_KEY, {
		scope: 'user',
		how,
	});

/** Id de recurso global (catálogo de planos, CEP, documento público de RI). */
export const NotUserScoped = (reason: string) =>
	SetMetadata<string, OwnershipDeclaration>(OWNERSHIP_KEY, {
		scope: 'global',
		how: reason,
	});
