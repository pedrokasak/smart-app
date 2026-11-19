import {
	AssetClass,
	Provenance,
	TransactionSide,
	TransactionSource,
} from './enums';

export interface TransactionInput {
	symbol: string;
	assetClass: AssetClass;
	side: TransactionSide;
	quantity: number;
	unitPriceMinor: number;
	feesMinor: number;
	currency: string;
	tradeDate: string;
	liquidityDays?: number;
}

export interface NewTransaction extends TransactionInput {
	orgId: string;
	clientProfileId: string;
	provenance: Provenance;
	source: TransactionSource;
	importBatchId?: string;
	createdByUserId: string;
}

export interface Transaction extends NewTransaction {
	id: string;
	createdAt: Date;
}

export interface Position {
	symbol: string;
	assetClass: AssetClass;
	quantity: number;
	costMinor: number;
	provenance: Provenance;
	liquidityDays?: number;
}

export interface AllocationTarget {
	orgId: string;
	clientProfileId: string;
	targets: Partial<Record<AssetClass, number>>;
	updatedByUserId: string;
	updatedAt: Date;
}
