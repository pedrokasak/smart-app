import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import {
	AssetClass,
	OrgRole,
	ProfileOrigin,
	Provenance,
	TransactionSide,
	TransactionSource,
} from '../domain/enums';
import { TransactionInput } from '../domain/portfolio.entities';
import { derivePositions } from '../domain/positions';
import { ClientNotAccessibleError } from './access-errors';
import { AuthorizationService } from './authorization.service';
import {
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
	InMemoryMembershipStore,
	InMemoryRelationshipStore,
	InMemoryTransactionStore,
} from './in-memory-stores.fixture';
import { RelationshipService } from './relationship.service';
import {
	InvalidTransactionError,
	OversellError,
	TransactionService,
} from './transaction.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];
	failWith?: Error;

	async record(event: AuditEventInput): Promise<void> {
		if (this.failWith) throw this.failWith;
		this.recorded.push(event);
	}
}

const buy = (over: Partial<TransactionInput> = {}): TransactionInput => ({
	symbol: ' petr4 ',
	assetClass: AssetClass.Stock,
	side: TransactionSide.Buy,
	quantity: 10,
	unitPriceMinor: 3000,
	feesMinor: 100,
	currency: 'BRL',
	tradeDate: '2025-01-10',
	...over,
});

describe('TransactionService', () => {
	const userId = 'user-1';
	const ctx = { userId, orgId: 'orgA' };
	let transactions: InMemoryTransactionStore;
	let relationships: InMemoryRelationshipStore;
	let rel: RelationshipService;
	let audit: FakeAuditTrail;
	let assignments: InMemoryAssignmentStore;
	let service: TransactionService;

	beforeEach(async () => {
		const memberships = new InMemoryMembershipStore();
		const profiles = new InMemoryClientProfileStore();
		relationships = new InMemoryRelationshipStore();
		rel = new RelationshipService(relationships);
		audit = new FakeAuditTrail();
		transactions = new InMemoryTransactionStore();
		assignments = new InMemoryAssignmentStore();
		const authz = new AuthorizationService(
			memberships,
			relationships,
			profiles,
			assignments,
			audit
		);
		service = new TransactionService(authz, transactions);
		await memberships.create({ userId, orgId: 'orgA', role: OrgRole.Advisor });
		profiles.seed({
			id: 'clientA',
			orgId: 'orgA',
			name: 'clientA',
			origin: ProfileOrigin.AdvisorCreated,
		});
		profiles.seed({
			id: 'clientB',
			orgId: 'orgB',
			name: 'clientB',
			origin: ProfileOrigin.AdvisorCreated,
		});
		profiles.seed({
			id: 'clientC',
			orgId: 'orgA',
			name: 'clientC',
			origin: ProfileOrigin.AdvisorCreated,
		});
		await rel.create('orgA', 'clientA');
		await rel.create('orgB', 'clientB');
		await assignments.assign('orgA', 'clientA', userId, userId);
		await assignments.assign('orgA', 'clientC', userId, userId);
	});

	const stored = () => transactions.listByClient('orgA', 'clientA');

	describe('addManual', () => {
		it('stores a MANUAL entry from ctx and audits EDIT_POSITION', async () => {
			const tx = await service.addManual(ctx, 'clientA', {
				...buy(),
				...({ orgId: 'evil', createdByUserId: 'evil' } as object),
			});

			expect(tx).toMatchObject({
				symbol: 'PETR4',
				orgId: 'orgA',
				clientProfileId: 'clientA',
				provenance: Provenance.Manual,
				source: TransactionSource.ManualEntry,
				createdByUserId: userId,
			});
			expect(await stored()).toHaveLength(1);
			expect(audit.recorded).toHaveLength(1);
			expect(audit.recorded[0].type).toBe('advisor.client.accessed');
			expect(audit.recorded[0].payload).toMatchObject({
				action: 'EDIT_POSITION',
			});
		});

		it('rejects invalid input with the error codes and stores nothing', async () => {
			const error = await service
				.addManual(ctx, 'clientA', buy({ quantity: -1, currency: 'USD' }))
				.catch((e: unknown) => e);

			expect(error).toBeInstanceOf(InvalidTransactionError);
			expect((error as InvalidTransactionError).getResponse()).toEqual({
				errors: ['INVALID_QUANTITY', 'UNSUPPORTED_CURRENCY'],
			});
			expect(await stored()).toHaveLength(0);
		});

		it('rejects a sale larger than the balance', async () => {
			await service.addManual(ctx, 'clientA', buy());
			const error = await service
				.addManual(
					ctx,
					'clientA',
					buy({ side: TransactionSide.Sell, quantity: 11 })
				)
				.catch((e: unknown) => e);

			expect(error).toBeInstanceOf(OversellError);
			expect((error as OversellError).getResponse()).toMatchObject({
				symbol: 'PETR4',
				tradeDate: '2025-01-10',
			});
			expect(await stored()).toHaveLength(1);
		});

		it('rejects a sale dated before the purchase that would cover it', async () => {
			await service.addManual(ctx, 'clientA', buy());
			await expect(
				service.addManual(
					ctx,
					'clientA',
					buy({ side: TransactionSide.Sell, tradeDate: '2025-01-05' })
				)
			).rejects.toBeInstanceOf(OversellError);
			expect(await stored()).toHaveLength(1);
		});

		it('accepts a sale covered by the balance', async () => {
			await service.addManual(ctx, 'clientA', buy());
			const sale = await service.addManual(
				ctx,
				'clientA',
				buy({
					side: TransactionSide.Sell,
					quantity: 4,
					tradeDate: '2025-02-01',
				})
			);
			expect(sale.side).toBe(TransactionSide.Sell);
			expect(await stored()).toHaveLength(2);
		});

		it('refuses an advisor of another org and touches nothing', async () => {
			const spy = jest.spyOn(transactions, 'listByClient');
			const create = jest.spyOn(transactions, 'createMany');
			await expect(
				service.addManual({ userId, orgId: 'orgB' }, 'clientB', buy())
			).rejects.toBeInstanceOf(ForbiddenException);
			await expect(
				service.addManual(ctx, 'clientB', buy())
			).rejects.toBeInstanceOf(ForbiddenException);
			expect(spy).not.toHaveBeenCalled();
			expect(create).not.toHaveBeenCalled();
		});

		it('fails closed when the audit trail fails', async () => {
			audit.failWith = new Error('audit down');
			await expect(service.addManual(ctx, 'clientA', buy())).rejects.toThrow(
				'audit down'
			);
			expect(await stored()).toHaveLength(0);
		});
	});

	describe('revoked relationship', () => {
		it('refuses addManual, listTransactions and getPositions', async () => {
			const relationship = await relationships.findByOrgAndClient(
				'orgA',
				'clientA'
			);
			await rel.revoke(relationship!.id);
			const read = jest.spyOn(transactions, 'listByClient');

			await expect(
				service.addManual(ctx, 'clientA', buy())
			).rejects.toBeInstanceOf(ForbiddenException);
			await expect(
				service.listTransactions(ctx, 'clientA')
			).rejects.toBeInstanceOf(ForbiddenException);
			await expect(service.getPositions(ctx, 'clientA')).rejects.toBeInstanceOf(
				ForbiddenException
			);
			expect(read).not.toHaveBeenCalled();
		});
	});

	describe('removeManual', () => {
		it('removes a manual transaction', async () => {
			const tx = await service.addManual(ctx, 'clientA', buy());
			await service.removeManual(ctx, 'clientA', tx.id);
			expect(await stored()).toHaveLength(0);
		});

		it('refuses to remove a VERIFIED transaction', async () => {
			const [verified] = await transactions.createMany([
				{
					...buy({ symbol: 'PETR4' }),
					orgId: 'orgA',
					clientProfileId: 'clientA',
					provenance: Provenance.Verified,
					source: TransactionSource.CsvImport,
					createdByUserId: userId,
				},
			]);
			await expect(
				service.removeManual(ctx, 'clientA', verified.id)
			).rejects.toBeInstanceOf(ForbiddenException);
			expect(await stored()).toHaveLength(1);
		});

		it('returns NotFound for an id of another client', async () => {
			await rel.create('orgA', 'clientC');
			const [other] = await transactions.createMany([
				{
					...buy({ symbol: 'PETR4' }),
					orgId: 'orgA',
					clientProfileId: 'clientC',
					provenance: Provenance.Manual,
					source: TransactionSource.ManualEntry,
					createdByUserId: userId,
				},
			]);
			await expect(
				service.removeManual(ctx, 'clientA', other.id)
			).rejects.toBeInstanceOf(NotFoundException);
			expect(await transactions.listByClient('orgA', 'clientC')).toHaveLength(
				1
			);
		});

		it('refuses removing a purchase that leaves a sale uncovered', async () => {
			const buyTx = await service.addManual(ctx, 'clientA', buy());
			await service.addManual(
				ctx,
				'clientA',
				buy({
					side: TransactionSide.Sell,
					quantity: 5,
					tradeDate: '2025-02-01',
				})
			);
			await expect(
				service.removeManual(ctx, 'clientA', buyTx.id)
			).rejects.toBeInstanceOf(OversellError);
			expect(await stored()).toHaveLength(2);
		});
	});

	describe('ledger with a pre-existing oversell of another symbol', () => {
		const seedLegacySale = () =>
			transactions.createMany([
				{
					...buy({ symbol: 'VALE3', side: TransactionSide.Sell }),
					orgId: 'orgA',
					clientProfileId: 'clientA',
					provenance: Provenance.Verified,
					source: TransactionSource.CsvImport,
					createdByUserId: userId,
				},
			]);

		it('still allows writing and removing an unrelated symbol', async () => {
			await seedLegacySale();
			const added = await service.addManual(ctx, 'clientA', buy());
			await expect(
				service.removeManual(ctx, 'clientA', added.id)
			).resolves.toBeUndefined();
		});

		it('still refuses another sale of the oversold symbol', async () => {
			await seedLegacySale();
			const error = await service
				.addManual(
					ctx,
					'clientA',
					buy({ symbol: 'vale3', side: TransactionSide.Sell })
				)
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(OversellError);
			expect((error as OversellError).getResponse()).toMatchObject({
				symbol: 'VALE3',
			});
		});
	});

	describe('atribuição', () => {
		it('nega listTransactions ao ADVISOR desatribuído na chamada seguinte, sem auditar', async () => {
			await service.listTransactions(ctx, 'clientA');
			audit.recorded.length = 0;
			await assignments.unassign('orgA', 'clientA', userId);
			const read = jest.spyOn(transactions, 'listByClient');

			await expect(
				service.listTransactions(ctx, 'clientA')
			).rejects.toBeInstanceOf(ClientNotAccessibleError);
			expect(audit.recorded).toHaveLength(0);
			expect(read).not.toHaveBeenCalled();
		});
	});

	describe('reads', () => {
		it('getPositions equals derivePositions of the ledger and audits VIEW_PORTFOLIO', async () => {
			await service.addManual(ctx, 'clientA', buy());
			audit.recorded.length = 0;

			const result = await service.getPositions(ctx, 'clientA');

			expect(result).toEqual(derivePositions(await stored()));
			expect(result.positions).toHaveLength(1);
			expect(audit.recorded).toHaveLength(1);
			expect(audit.recorded[0].payload).toMatchObject({
				action: 'VIEW_PORTFOLIO',
			});
		});

		it('listTransactions returns the ledger and audits VIEW_PORTFOLIO', async () => {
			await service.addManual(ctx, 'clientA', buy());
			audit.recorded.length = 0;

			expect(await service.listTransactions(ctx, 'clientA')).toHaveLength(1);
			expect(audit.recorded[0].payload).toMatchObject({
				action: 'VIEW_PORTFOLIO',
			});
		});
	});
});
