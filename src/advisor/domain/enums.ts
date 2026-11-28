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

export enum MemberInviteStatus {
	Pending = 'PENDING',
	Accepted = 'ACCEPTED',
	Declined = 'DECLINED',
	Cancelled = 'CANCELLED',
	Expired = 'EXPIRED',
}

export enum AlertRule {
	PositionDrop = 'POSITION_DROP',
	PortfolioDrawdown = 'PORTFOLIO_DRAWDOWN',
	Concentration = 'CONCENTRATION',
	TargetDrift = 'TARGET_DRIFT',
	LargeSells = 'LARGE_SELLS',
	NoContact = 'NO_CONTACT',
	Manual = 'MANUAL',
}

/** Rank 0-3: menor é mais grave. */
export enum AlertPriority {
	P0 = 'P0',
	P1 = 'P1',
	P2 = 'P2',
	P3 = 'P3',
}

export enum AlertStatus {
	Open = 'OPEN',
	Snoozed = 'SNOOZED',
	Handled = 'HANDLED',
	Dismissed = 'DISMISSED',
	Resolved = 'RESOLVED',
}

export enum AlertHandledVia {
	Email = 'EMAIL',
	Reviewed = 'REVIEWED',
}

export enum SnapshotSource {
	AdvisorLedger = 'ADVISOR_LEDGER',
	B2cShared = 'B2C_SHARED',
}
