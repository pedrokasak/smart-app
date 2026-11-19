import type { IrGuideStep } from 'src/fiscal/domain/ir-guide';

export interface IrPositionItemDto {
	symbol: string;
	quantity: number;
	averagePrice: number;
	costBasis: number;
}

export interface IrProventosItemDto {
	symbol: string;
	total: number;
}

export interface IrOperationMonthlyItemDto {
	month: number;
	grossSales: number;
	realizedResult: number;
}

export type IrGuideStepDto = IrGuideStep;

/** Ativo cujo histórico de negociações não fecha (venda maior que a posição conhecida). */
export interface IrIncompleteHistoryItemDto {
	symbol: string;
	missingQuantity: number;
	firstShortfallDate: string;
}

export interface IrCryptoSectionDto {
	positions: IrPositionItemDto[];
	operations: IrOperationMonthlyItemDto[];
	totalRealizedResult: number;
}

export interface IrReportResponseDto {
	year: number;
	generatedAt: string;
	positionAtYearEnd: IrPositionItemDto[];
	dividends: IrProventosItemDto[];
	dividendsTotal: number;
	jcp: IrProventosItemDto[];
	jcpTotal: number;
	taxableOperations: IrOperationMonthlyItemDto[];
	taxableOperationsTotal: number;
	compensableLosses: IrOperationMonthlyItemDto[];
	compensableLossesTotal: number;
	crypto: IrCryptoSectionDto;
	guide: IrGuideStepDto[];
	/** Ativos com venda sem posição suficiente: posição e custo podem estar errados. */
	incompleteHistory: IrIncompleteHistoryItemDto[];
	notes: string[];
}
