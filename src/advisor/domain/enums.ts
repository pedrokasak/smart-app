export enum OrgRole {
	OrgAdmin = 'ORG_ADMIN',
	Advisor = 'ADVISOR',
}

export enum AdvisorType {
	Assessor = 'ASSESSOR',
	Consultor = 'CONSULTOR',
}

export enum ProfileOrigin {
	AdvisorCreated = 'ADVISOR_CREATED',
	ClientCreated = 'CLIENT_CREATED',
}

export enum RelationshipStatus {
	Active = 'ACTIVE',
	Pending = 'PENDING',
	Revoked = 'REVOKED',
}

export type ClientAction =
	| 'VIEW_PORTFOLIO'
	| 'PUBLISH_REPORT'
	| 'EDIT_POSITION';

export enum AssetClass {
	Stock = 'STOCK',
	Fii = 'FII',
	Etf = 'ETF',
	Crypto = 'CRYPTO',
	Fund = 'FUND',
	FixedIncome = 'FIXED_INCOME',
	Other = 'OTHER',
}

export enum TransactionSide {
	Buy = 'BUY',
	Sell = 'SELL',
}

export enum Provenance {
	Verified = 'VERIFIED',
	Manual = 'MANUAL',
}

export enum PortfolioProvenance {
	Verified = 'VERIFIED',
	Partial = 'PARTIAL',
	Manual = 'MANUAL',
}

export enum TransactionSource {
	ManualEntry = 'MANUAL_ENTRY',
	CsvImport = 'CSV_IMPORT',
}

export enum ImportBatchStatus {
	Pending = 'PENDING',
	Completed = 'COMPLETED',
}

export enum LiquidityBucket {
	D0 = 'D0',
	D1_2 = 'D1_2',
	D3_30 = 'D3_30',
	D31Plus = 'D31_PLUS',
	Unknown = 'UNKNOWN',
}

export enum InviteStatus {
	Pending = 'PENDING',
	Accepted = 'ACCEPTED',
	Declined = 'DECLINED',
	Expired = 'EXPIRED',
	Cancelled = 'CANCELLED',
}

export enum ConsentStatus {
	Active = 'ACTIVE',
	Superseded = 'SUPERSEDED',
	Revoked = 'REVOKED',
}
