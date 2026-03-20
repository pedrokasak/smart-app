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

export interface IrGuideStepDto {
	title: string;
	details: string;
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
	notes: string[];
}
