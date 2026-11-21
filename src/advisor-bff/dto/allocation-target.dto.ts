import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';
import { AssetClass } from 'src/advisor/domain/enums';
import type { AllocationTarget } from 'src/advisor/domain/portfolio.entities';

const TARGETS_DESCRIPTION =
	'Percentual por classe de ativo (STOCK, FII, ETF, CRYPTO, FUND, ' +
	'FIXED_INCOME, OTHER); a soma é 100';

export class SetAllocationTargetDto {
	/** Chaves e valores são validados pelo serviço (422 com `reason`). */
	@ApiProperty({
		type: 'object',
		additionalProperties: { type: 'number', minimum: 0, maximum: 100 },
		description: TARGETS_DESCRIPTION,
		example: { [AssetClass.Stock]: 60, [AssetClass.Fii]: 40 },
	})
	@IsObject()
	targets: Partial<Record<AssetClass, number>>;
}

/** Cliente sem meta definida responde 200 com os dois campos nulos. */
export class AllocationTargetResponseDto {
	@ApiProperty({
		type: 'object',
		additionalProperties: { type: 'number' },
		nullable: true,
		description: TARGETS_DESCRIPTION,
	})
	targets: Partial<Record<AssetClass, number>> | null;

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	updatedAt: string | null;

	static of(target: AllocationTarget | null): AllocationTargetResponseDto {
		if (!target) return { targets: null, updatedAt: null };
		return {
			targets: { ...target.targets },
			updatedAt: target.updatedAt.toISOString(),
		};
	}
}
