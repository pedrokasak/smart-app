import {
	IsDateString,
	IsIn,
	Matches,
	IsNumber,
	IsOptional,
	Max,
	Min,
	ValidateIf,
} from 'class-validator';
import type { Indexer } from '../../domain/instrument';
import type { PositionKind } from '../../domain/fixed-income.types';

export const POSITION_KINDS: readonly PositionKind[] = [
	'CDB',
	'LC',
	'LCI',
	'LCA',
	'CRI',
	'CRA',
	'DEBENTURE',
	'DEBENTURE_INCENTIVADA',
	'TESOURO',
];

export const POSITION_INDEXERS: readonly Indexer[] = [
	'PERCENT_CDI',
	'CDI_PLUS',
	'PREFIXED',
	'IPCA_PLUS',
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Cadastro de uma posição de renda fixa (TRA-230). */
export class CreateFixedIncomePositionDto {
	@IsIn(POSITION_KINDS)
	kind: PositionKind;

	@IsIn(POSITION_INDEXERS)
	indexer: Indexer;

	/**
	 * % do CDI (1–300), spread da Selic (−5 a 5), taxa prefixada (0–100) ou
	 * juro real do IPCA+ (−5 a 30). A faixa fina por indexador fica no
	 * domínio; aqui só barra o absurdo.
	 */
	@IsNumber({ allowNaN: false, allowInfinity: false })
	@Min(-5)
	@Max(300)
	ratePct: number;

	@IsNumber({ allowNaN: false, allowInfinity: false })
	@Min(0.01)
	@Max(1_000_000_000)
	principal: number;

	@Matches(ISO_DAY)
	@IsDateString({ strict: true })
	appliedAt: string;

	@IsOptional()
	@ValidateIf((_o, value) => value !== null)
	@Matches(ISO_DAY)
	@IsDateString({ strict: true })
	maturityDate?: string | null;
}
