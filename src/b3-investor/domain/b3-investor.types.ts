/**
 * Tipos de domínio da API "Área do Investidor" da B3 (TRA-185).
 *
 * Espelham só os campos que o Trackerr usa. Os nomes seguem o Swagger
 * público em developers.b3.com.br (lido em 2026-10-28). Datas de
 * referência são strings `AAAA-MM-DD`, o formato que a B3 aceita e devolve.
 */

/** Produtos aceitos pela API Guia (`/api/updated-product/v1/investors`). */
export const B3_UPDATED_PRODUCTS = [
	'ProvisionedEvents',
	'Collaterals',
	'AssetsTrading',
	'PublicOffers',
	'DerivativesMovement',
	'SecuritiesLendingMovement',
	'FixedIncomeMovement',
	'EquitiesMovement',
	'TreasuryBondsMovement',
	'DerivativesPosition',
	'SecuritiesLendingPosition',
	'FixedIncomePosition',
	'EquitiesPosition',
	'TreasuryBondsPosition',
] as const;

export type B3UpdatedProduct = (typeof B3_UPDATED_PRODUCTS)[number];

/** Data no formato `AAAA-MM-DD`. */
export type B3ReferenceDate = string;

export interface B3DateRange {
	start: B3ReferenceDate;
	end: B3ReferenceDate;
}

export interface B3AuthorizedInvestor {
	documentNumber: string;
	authorizedAt: string | null;
}

export interface B3EquityPosition {
	documentNumber: string;
	referenceDate: B3ReferenceDate;
	productCategory: string;
	productType: string;
	ticker: string;
	isin: string;
	quantity: number;
	availableQuantity: number;
	unavailableQuantity: number;
	closingPrice: number;
	marketValue: number;
	custodian: string;
	custodianDocument: string;
}

export interface B3TreasuryBondPosition {
	documentNumber: string;
	referenceDate: B3ReferenceDate;
	ticker: string;
	isin: string;
	description: string;
	expirationDate: B3ReferenceDate;
	quantity: number;
	appliedValue: number;
	marketValue: number;
	grossAmount: number;
	netValue: number;
	indexName: string;
	interestRate: number;
	custodian: string;
	custodianDocument: string;
}

/**
 * Renda fixa de balcão. A B3 não manda preço para ativos registrados,
 * então os campos de valor podem vir nulos.
 */
export interface B3FixedIncomePosition {
	documentNumber: string;
	referenceDate: B3ReferenceDate;
	productType: string;
	ticker: string;
	issuer: string;
	description: string;
	issueDate: B3ReferenceDate;
	expirationDate: B3ReferenceDate;
	quantity: number;
	availableQuantity: number;
	appliedValue: number | null;
	marketValue: number | null;
	indexName: string | null;
	custodian: string;
	custodianDocument: string;
}

export interface B3EquityMovement {
	referenceDate: B3ReferenceDate;
	movementType: string;
	operationType: string;
	productType: string;
	ticker: string;
	isin: string | null;
	quantity: number;
	unitPrice: number;
	operationValue: number;
	custodian: string;
	custodianDocument: string;
}

export interface B3AssetTrade {
	referenceDate: B3ReferenceDate;
	ticker: string;
	side: 'buy' | 'sell';
	market: string;
	quantity: number;
	price: number | null;
	grossAmount: number | null;
	tradedAt: string | null;
	custodian: string;
	custodianDocument: string;
}
