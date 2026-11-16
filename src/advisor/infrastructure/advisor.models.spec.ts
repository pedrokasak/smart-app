import mongoose, { Model } from 'mongoose';
import { advisorSchemas } from './advisor.models';
import {
	AdvisorImportBatchDoc,
	advisorPortfolioSchemas,
	AdvisorTransactionDoc,
} from './advisor-portfolio.models';

type IndexEntry = [Record<string, number>, Record<string, unknown>];

function findIndex(
	indexes: IndexEntry[],
	fields: Record<string, number>
): IndexEntry | undefined {
	return indexes.find(
		([spec]) => JSON.stringify(spec) === JSON.stringify(fields)
	);
}

describe('advisor schemas', () => {
	it('uses the expected collection names', () => {
		expect(advisorSchemas.organization.get('collection')).toBe(
			'advisor_organizations'
		);
		expect(advisorSchemas.membership.get('collection')).toBe(
			'advisor_memberships'
		);
		expect(advisorSchemas.relationship.get('collection')).toBe(
			'advisor_relationships'
		);
		expect(advisorSchemas.clientProfile.get('collection')).toBe(
			'advisor_client_profiles'
		);
	});

	it('membership has a unique index on userId + orgId', () => {
		const index = findIndex(
			advisorSchemas.membership.indexes() as IndexEntry[],
			{
				userId: 1,
				orgId: 1,
			}
		);
		expect(index).toBeDefined();
		expect(index?.[1].unique).toBe(true);
	});

	it('relationship has a unique partial index (ACTIVE only) on orgId + clientProfileId', () => {
		const index = findIndex(
			advisorSchemas.relationship.indexes() as IndexEntry[],
			{ orgId: 1, clientProfileId: 1 }
		);
		expect(index).toBeDefined();
		expect(index?.[1].unique).toBe(true);
		expect(index?.[1].partialFilterExpression).toEqual({ status: 'ACTIVE' });
	});
});

describe('advisor portfolio schemas', () => {
	it('uses the expected collection names', () => {
		expect(advisorPortfolioSchemas.transaction.get('collection')).toBe(
			'advisor_transactions'
		);
		expect(advisorPortfolioSchemas.importBatch.get('collection')).toBe(
			'advisor_import_batches'
		);
		expect(advisorPortfolioSchemas.allocationTarget.get('collection')).toBe(
			'advisor_allocation_targets'
		);
	});

	it('transaction has the ledger order and import batch indexes', () => {
		const indexes =
			advisorPortfolioSchemas.transaction.indexes() as IndexEntry[];
		expect(
			findIndex(indexes, {
				orgId: 1,
				clientProfileId: 1,
				tradeDate: 1,
				createdAt: 1,
			})
		).toBeDefined();
		expect(
			findIndex(indexes, { orgId: 1, clientProfileId: 1, importBatchId: 1 })
		).toBeDefined();
	});

	it('import batch has a unique index on orgId + clientProfileId + sourceHash', () => {
		const index = findIndex(
			advisorPortfolioSchemas.importBatch.indexes() as IndexEntry[],
			{ orgId: 1, clientProfileId: 1, sourceHash: 1 }
		);
		expect(index).toBeDefined();
		expect(index?.[1].unique).toBe(true);
	});

	it('allocation target has a unique index on orgId + clientProfileId', () => {
		const index = findIndex(
			advisorPortfolioSchemas.allocationTarget.indexes() as IndexEntry[],
			{ orgId: 1, clientProfileId: 1 }
		);
		expect(index).toBeDefined();
		expect(index?.[1].unique).toBe(true);
	});

	describe('transaction validation', () => {
		const model = (): Model<AdvisorTransactionDoc> =>
			mongoose.model<AdvisorTransactionDoc>(
				`AdvisorTransactionSpec${Math.random()}`,
				advisorPortfolioSchemas.transaction
			);
		const valid = {
			orgId: 'o',
			clientProfileId: 'c',
			symbol: 'PETR4',
			assetClass: 'STOCK',
			side: 'BUY',
			quantity: 10,
			unitPriceMinor: 3500,
			feesMinor: 100,
			currency: 'BRL',
			tradeDate: '2026-01-10',
			provenance: 'MANUAL',
			source: 'MANUAL_ENTRY',
			createdByUserId: 'u1',
		};

		it('accepts a valid document', () => {
			const M = model();
			expect(new M(valid).validateSync()).toBeUndefined();
		});

		it.each([
			['fractional unitPriceMinor', { unitPriceMinor: 10.5 }],
			['fractional feesMinor', { feesMinor: 0.5 }],
			['zero quantity', { quantity: 0 }],
			['negative quantity', { quantity: -1 }],
			['unknown side', { side: 'HOLD' }],
			['unknown asset class', { assetClass: 'GOLD' }],
			['malformed tradeDate', { tradeDate: '10/01/2026' }],
			['fractional liquidityDays', { liquidityDays: 1.5 }],
		])('rejects %s', (_label, patch) => {
			const M = model();
			expect(new M({ ...valid, ...patch }).validateSync()).toBeDefined();
		});
	});

	describe('import batch status', () => {
		const model = (): Model<AdvisorImportBatchDoc> =>
			mongoose.model<AdvisorImportBatchDoc>(
				`AdvisorImportBatchSpec${Math.random()}`,
				advisorPortfolioSchemas.importBatch
			);
		const valid = {
			orgId: 'o',
			clientProfileId: 'c',
			sourceHash: 'h',
			createdByUserId: 'u1',
		};

		it('defaults to PENDING and is required', () => {
			const M = model();
			const doc = new M(valid);
			expect(doc.status).toBe('PENDING');
			expect(doc.validateSync()).toBeUndefined();
			expect(
				new M({ ...valid, status: null }).validateSync()?.errors.status
			).toBeDefined();
		});

		it('accepts COMPLETED and rejects an unknown status', () => {
			const M = model();
			expect(
				new M({ ...valid, status: 'COMPLETED' }).validateSync()
			).toBeUndefined();
			expect(
				new M({ ...valid, status: 'DONE' }).validateSync()?.errors.status
			).toBeDefined();
		});
	});
});
