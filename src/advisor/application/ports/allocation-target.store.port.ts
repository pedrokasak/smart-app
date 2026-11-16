import { AllocationTarget } from '../../domain/portfolio.entities';

export interface AllocationTargetStorePort {
	/** Um registro por (orgId, clientProfileId); o último valor vence. */
	upsert(
		target: Omit<AllocationTarget, 'updatedAt'>
	): Promise<AllocationTarget>;
	find(
		orgId: string,
		clientProfileId: string
	): Promise<AllocationTarget | null>;
}
