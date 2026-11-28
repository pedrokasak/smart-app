import {
	Inject,
	Injectable,
	UnprocessableEntityException,
} from '@nestjs/common';
import { AssetClass } from '../domain/enums';
import { AllocationTarget } from '../domain/portfolio.entities';
import {
	ADVISOR_ALLOCATION_TARGET_STORE,
	ADVISOR_SNAPSHOT_TRIGGER,
} from './advisor.tokens';
import { AccessContext, AuthorizationService } from './authorization.service';
import type { AllocationTargetStorePort } from './ports/allocation-target.store.port';
import type { ClientSnapshotTriggerPort } from './ports/client-snapshot-trigger.port';

const SUM_TOLERANCE = 0.01;

export class InvalidAllocationTargetError extends UnprocessableEntityException {
	constructor(reason: string) {
		super({ reason });
	}
}

@Injectable()
export class AllocationTargetService {
	constructor(
		private readonly authorization: AuthorizationService,
		@Inject(ADVISOR_ALLOCATION_TARGET_STORE)
		private readonly targets: AllocationTargetStorePort,
		@Inject(ADVISOR_SNAPSHOT_TRIGGER)
		private readonly snapshotTrigger: ClientSnapshotTriggerPort
	) {}

	async setTarget(
		ctx: AccessContext,
		clientProfileId: string,
		targets: Partial<Record<AssetClass, number>>
	): Promise<AllocationTarget> {
		await this.authorization.ensureCanAccessClient(
			ctx,
			clientProfileId,
			'EDIT_POSITION'
		);
		const clean = this.validate(targets);
		const saved = await this.targets.upsert({
			orgId: ctx.orgId,
			clientProfileId,
			targets: clean,
			updatedByUserId: ctx.userId,
		});
		this.snapshotTrigger.request(ctx.orgId, clientProfileId);
		return saved;
	}

	async getTarget(
		ctx: AccessContext,
		clientProfileId: string
	): Promise<AllocationTarget | null> {
		await this.authorization.ensureCanAccessClient(
			ctx,
			clientProfileId,
			'VIEW_PORTFOLIO'
		);
		return this.targets.find(ctx.orgId, clientProfileId);
	}

	private validate(
		targets: Partial<Record<AssetClass, number>>
	): Partial<Record<AssetClass, number>> {
		const classes = new Set<string>(Object.values(AssetClass));
		const entries = Object.entries(targets ?? {});
		if (entries.length === 0) {
			throw new InvalidAllocationTargetError('EMPTY_TARGET');
		}
		const clean: Partial<Record<AssetClass, number>> = {};
		let sum = 0;
		for (const [key, value] of entries) {
			if (!classes.has(key)) {
				throw new InvalidAllocationTargetError('UNKNOWN_ASSET_CLASS');
			}
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				throw new InvalidAllocationTargetError('INVALID_VALUE');
			}
			if (value < 0 || value > 100) {
				throw new InvalidAllocationTargetError('VALUE_OUT_OF_RANGE');
			}
			clean[key as AssetClass] = value;
			sum += value;
		}
		if (Math.abs(sum - 100) > SUM_TOLERANCE) {
			throw new InvalidAllocationTargetError('SUM_NOT_100');
		}
		return clean;
	}
}
