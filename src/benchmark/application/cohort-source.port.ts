import type { CohortMember } from 'src/benchmark/domain/cohort';

export const COHORT_SOURCE = Symbol('COHORT_SOURCE');

export type IneligibleReason =
	| 'no_portfolio'
	| 'short_history'
	| 'no_return_series';

export type MemberLookup =
	| { eligible: true; member: CohortMember }
	| { eligible: false; reason: IneligibleReason };

/**
 * De onde vêm as carteiras do benchmark. `members()` devolve membros SEM
 * identificação (o job mensal agrega e descarta); `memberFor()` devolve o
 * membro de UMA pessoa, para ela se comparar com o agregado.
 */
export interface CohortSourcePort {
	members(): AsyncIterable<CohortMember>;
	memberFor(userId: string): Promise<MemberLookup>;
}
