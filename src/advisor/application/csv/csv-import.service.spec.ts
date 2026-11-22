import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import {
	OrgRole,
	ProfileOrigin,
	Provenance,
	TransactionSource,
} from '../../domain/enums';
import { AuthorizationService } from '../authorization.service';
import {
	InMemoryAssignmentStore,
	InMemoryClientProfileStore,
	InMemoryMembershipStore,
	InMemoryRelationshipStore,
	InMemoryTransactionStore,
} from '../in-memory-stores.fixture';
import {
	DuplicateImportError,
	STALE_IMPORT_MS,
} from '../ports/transaction.store.port';
import { RelationshipService } from '../relationship.service';
import { OversellError, TransactionService } from '../transaction.service';
import { CSV_MAX_BYTES } from './advisor-csv.parser';
import { CsvImportService, CsvRejectedError } from './csv-import.service';

jest.mock('src/env', () => ({ jwtSecret: 'test-secret-for-audit-trail' }));

class FakeAuditTrail implements AuditTrail {
	readonly recorded: AuditEventInput[] = [];
	async record(event: AuditEventInput): Promise<void> {
		this.recorded.push(event);
	}
}

const HEADER = 'data;ativo;classe;lado;quantidade;preco;taxas';
const csvOf = (...lines: string[]) => [HEADER, ...lines].join('\n') + '\n';
const THREE = csvOf(
	'02/01/2025;PETR4;ACAO;C;100;30,00;1,00',
	'03/01/2025;VALE3;ACAO;C;50;60,00;0',
	'10/02/2025;PETR4;ACAO;V;40;35,00;0'
);

describe('CsvImportService', () => {
	const userId = 'user-1';
	const ctx = { userId, orgId: 'orgA' };
	let transactions: InMemoryTransactionStore;
	let relationships: InMemoryRelationshipStore;
	let rel: RelationshipService;
	let manual: TransactionService;
	let service: CsvImportService;

	beforeEach(async () => {
		const memberships = new InMemoryMembershipStore();
		const profiles = new InMemoryClientProfileStore();
		relationships = new InMemoryRelationshipStore();
		rel = new RelationshipService(relationships);
		transactions = new InMemoryTransactionStore();
		const assignments = new InMemoryAssignmentStore();
		const authz = new AuthorizationService(
			memberships,
			relationships,
			profiles,
			assignments,
			new FakeAuditTrail()
		);
		service = new CsvImportService(authz, transactions);
		manual = new TransactionService(authz, transactions);
		await memberships.create({ userId, orgId: 'orgA', role: OrgRole.Advisor });
		profiles.seed({
			id: 'clientA',
			orgId: 'orgA',
			name: 'clientA',
			origin: ProfileOrigin.AdvisorCreated,
		});
		profiles.seed({
			id: 'clientC',
			orgId: 'orgA',
			name: 'clientC',
			origin: ProfileOrigin.AdvisorCreated,
		});
		profiles.seed({
			id: 'clientB',
			orgId: 'orgB',
			name: 'clientB',
			origin: ProfileOrigin.AdvisorCreated,
		});
		await rel.create('orgA', 'clientA');
		await rel.create('orgA', 'clientC');
		await rel.create('orgB', 'clientB');
		await assignments.assign('orgA', 'clientA', userId, userId);
		await assignments.assign('orgA', 'clientC', userId, userId);
	});

	const stored = (client = 'clientA') =>
		transactions.listByClient('orgA', client);

	it('imports valid rows as VERIFIED CSV_IMPORT in one batch', async () => {
		const result = await service.importCsv(ctx, 'clientA', THREE);

		expect(result.imported).toBe(3);
		const ledger = await stored();
		expect(ledger).toHaveLength(3);
		for (const tx of ledger) {
			expect(tx).toMatchObject({
				orgId: 'orgA',
				clientProfileId: 'clientA',
				provenance: Provenance.Verified,
				source: TransactionSource.CsvImport,
				importBatchId: result.importBatchId,
				createdByUserId: userId,
			});
		}
	});

	it('rejects the same text twice and keeps the ledger at 3', async () => {
		await service.importCsv(ctx, 'clientA', THREE);
		await expect(
			service.importCsv(ctx, 'clientA', THREE)
		).rejects.toBeInstanceOf(ConflictException);
		expect(await stored()).toHaveLength(3);
	});

	it('accepts the same file for another client of the same org', async () => {
		await service.importCsv(ctx, 'clientA', THREE);
		await expect(service.importCsv(ctx, 'clientC', THREE)).resolves.toEqual(
			expect.objectContaining({ imported: 3 })
		);
	});

	it('reports parse errors with lines and stores nothing', async () => {
		const error = await service
			.importCsv(ctx, 'clientA', csvOf('02/01/2025;PETR4;ACAO;X;1;10,00;0'))
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(CsvRejectedError);
		expect((error as CsvRejectedError).getResponse()).toEqual({
			errors: [{ line: 2, code: 'INVALID_SIDE', column: 'lado' }],
		});
		expect(await stored()).toHaveLength(0);
	});

	describe('oversell', () => {
		const sellOnly = csvOf('10/02/2025;PETR4;ACAO;V;40;35,00;0');

		it('rejects a sale exceeding ledger + file, at the sale line, without reserving the hash', async () => {
			const error = await service
				.importCsv(ctx, 'clientA', sellOnly)
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(CsvRejectedError);
			expect((error as CsvRejectedError).getResponse()).toEqual({
				errors: [{ line: 2, code: 'INVALID_QUANTITY' }],
			});
			expect(await stored()).toHaveLength(0);

			await manual.addManual(ctx, 'clientA', {
				symbol: 'PETR4',
				assetClass: 'STOCK' as never,
				side: 'BUY' as never,
				quantity: 100,
				unitPriceMinor: 3000,
				feesMinor: 0,
				currency: 'BRL',
				tradeDate: '2025-01-02',
			});
			await expect(
				service.importCsv(ctx, 'clientA', sellOnly)
			).resolves.toEqual(expect.objectContaining({ imported: 1 }));
		});

		it('points at the file sale when the reported oversell is a stored later sale', async () => {
			const base = {
				symbol: 'PETR4',
				assetClass: 'STOCK' as never,
				quantity: 100,
				unitPriceMinor: 3000,
				feesMinor: 0,
				currency: 'BRL',
				orgId: 'orgA',
				clientProfileId: 'clientA',
				provenance: Provenance.Manual,
				source: TransactionSource.ManualEntry,
				createdByUserId: userId,
			};
			await transactions.createMany([
				{ ...base, side: 'BUY' as never, tradeDate: '2025-01-01' },
				{ ...base, side: 'SELL' as never, tradeDate: '2025-02-01' },
			]);
			const csv = csvOf('15/01/2025;PETR4;ACAO;V;50;35,00;0');
			const claim = jest.spyOn(transactions, 'claimImport');

			const error = await service
				.importCsv(ctx, 'clientA', csv)
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(CsvRejectedError);
			expect((error as CsvRejectedError).getResponse()).toEqual({
				errors: [{ line: 2, code: 'INVALID_QUANTITY' }],
			});
			expect(await stored()).toHaveLength(2);
			expect(claim).not.toHaveBeenCalled();
		});

		it('ignores a pre-existing uncovered sale of a symbol the file does not touch', async () => {
			await transactions.createMany([
				{
					symbol: 'AAAA3',
					assetClass: 'STOCK' as never,
					side: 'SELL' as never,
					quantity: 5,
					unitPriceMinor: 100,
					feesMinor: 0,
					currency: 'BRL',
					tradeDate: '2025-01-01',
					orgId: 'orgA',
					clientProfileId: 'clientA',
					provenance: Provenance.Manual,
					source: TransactionSource.ManualEntry,
					createdByUserId: userId,
				},
			]);
			await expect(
				service.importCsv(
					ctx,
					'clientA',
					csvOf('02/01/2025;BBBB3;ACAO;C;1;10,00;0')
				)
			).resolves.toEqual(expect.objectContaining({ imported: 1 }));
		});
	});

	it('discards the claim and propagates when createMany fails', async () => {
		const discard = jest.spyOn(transactions, 'discardImport');
		const create = jest
			.spyOn(transactions, 'createMany')
			.mockRejectedValueOnce(new Error('db down'));

		await expect(service.importCsv(ctx, 'clientA', THREE)).rejects.toThrow(
			'db down'
		);
		expect(discard).toHaveBeenCalledTimes(1);
		create.mockRestore();
		await expect(service.importCsv(ctx, 'clientA', THREE)).resolves.toEqual(
			expect.objectContaining({ imported: 3 })
		);
	});

	it('surfaces the createMany error even when discardImport also fails', async () => {
		const logged = jest
			.spyOn(Logger.prototype, 'error')
			.mockImplementation(() => undefined);
		const failure = new Error('db down');
		jest.spyOn(transactions, 'createMany').mockRejectedValueOnce(failure);
		jest
			.spyOn(transactions, 'discardImport')
			.mockRejectedValueOnce(new Error('discard failed'));

		await expect(service.importCsv(ctx, 'clientA', THREE)).rejects.toBe(
			failure
		);
		expect(logged).toHaveBeenCalledTimes(1);
		expect(String(logged.mock.calls[0][0])).not.toMatch(/PETR4|VALE3|clientA/);
		logged.mockRestore();
	});

	it('leaves a successful import COMPLETED: never taken over, even later', async () => {
		const complete = jest.spyOn(transactions, 'completeImport');
		const { importBatchId } = await service.importCsv(ctx, 'clientA', THREE);

		expect(complete).toHaveBeenCalledWith('orgA', 'clientA', importBatchId);
		const hash = createHash('sha256').update(THREE).digest('hex');
		await expect(
			transactions.claimImport(
				'orgA',
				'clientA',
				hash,
				userId,
				new Date(Date.now() + STALE_IMPORT_MS + 60_000)
			)
		).rejects.toBeInstanceOf(DuplicateImportError);
		await expect(
			service.importCsv(ctx, 'clientA', THREE)
		).rejects.toBeInstanceOf(ConflictException);
	});

	describe('revertImport', () => {
		it('removes the rows of the batch and frees the file for a new import', async () => {
			await manual.addManual(ctx, 'clientA', {
				symbol: 'ITUB4',
				assetClass: 'STOCK' as never,
				side: 'BUY' as never,
				quantity: 1,
				unitPriceMinor: 3000,
				feesMinor: 0,
				currency: 'BRL',
				tradeDate: '2025-01-02',
			});
			const { importBatchId } = await service.importCsv(ctx, 'clientA', THREE);

			await expect(
				service.revertImport(ctx, 'clientA', importBatchId)
			).resolves.toEqual({ removed: 3 });

			expect((await stored()).map((t) => t.symbol)).toEqual(['ITUB4']);
			await expect(service.importCsv(ctx, 'clientA', THREE)).resolves.toEqual(
				expect.objectContaining({ imported: 3 })
			);
		});

		it('refuses with OversellError and removes nothing when a later MANUAL sale would be uncovered', async () => {
			const { importBatchId } = await service.importCsv(ctx, 'clientA', THREE);
			await manual.addManual(ctx, 'clientA', {
				symbol: 'VALE3',
				assetClass: 'STOCK' as never,
				side: 'SELL' as never,
				quantity: 20,
				unitPriceMinor: 6500,
				feesMinor: 0,
				currency: 'BRL',
				tradeDate: '2025-03-03',
			});
			const discard = jest.spyOn(transactions, 'discardImport');

			const error = await service
				.revertImport(ctx, 'clientA', importBatchId)
				.catch((e: unknown) => e);

			expect(error).toBeInstanceOf(OversellError);
			expect((error as OversellError).getResponse()).toMatchObject({
				symbol: 'VALE3',
				tradeDate: '2025-03-03',
			});
			expect(discard).not.toHaveBeenCalled();
			expect(await stored()).toHaveLength(4);
		});

		it('refuses another org and another client, removing nothing', async () => {
			const { importBatchId } = await service.importCsv(ctx, 'clientA', THREE);
			const discard = jest.spyOn(transactions, 'discardImport');

			await expect(
				service.revertImport(
					{ userId, orgId: 'orgB' },
					'clientA',
					importBatchId
				)
			).rejects.toBeInstanceOf(ForbiddenException);
			await expect(
				service.revertImport(ctx, 'clientB', importBatchId)
			).rejects.toBeInstanceOf(ForbiddenException);

			expect(discard).not.toHaveBeenCalled();
			expect(await stored()).toHaveLength(3);
		});

		it('returns removed 0 for an unknown batch and still calls discard', async () => {
			await service.importCsv(ctx, 'clientA', THREE);
			const discard = jest.spyOn(transactions, 'discardImport');

			await expect(
				service.revertImport(ctx, 'clientA', 'unknown-batch')
			).resolves.toEqual({ removed: 0 });

			expect(discard).toHaveBeenCalledWith('orgA', 'clientA', 'unknown-batch');
			expect(await stored()).toHaveLength(3);
		});
	});

	it('rejects text above 1 MB with FILE_TOO_LARGE before parsing', async () => {
		const error = await service
			.importCsv(ctx, 'clientA', 'x'.repeat(CSV_MAX_BYTES + 1))
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(CsvRejectedError);
		expect((error as CsvRejectedError).getResponse()).toEqual({
			errors: [{ line: 1, code: 'FILE_TOO_LARGE' }],
		});
	});

	it('refuses another org and a revoked relationship, writing nothing', async () => {
		const create = jest.spyOn(transactions, 'createMany');
		const claim = jest.spyOn(transactions, 'claimImport');
		await expect(
			service.importCsv({ userId, orgId: 'orgB' }, 'clientB', THREE)
		).rejects.toBeInstanceOf(ForbiddenException);
		await expect(
			service.importCsv(ctx, 'clientB', THREE)
		).rejects.toBeInstanceOf(ForbiddenException);

		const relationship = await relationships.findByOrgAndClient(
			'orgA',
			'clientA'
		);
		await rel.revoke(relationship!.id);
		await expect(
			service.importCsv(ctx, 'clientA', THREE)
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(create).not.toHaveBeenCalled();
		expect(claim).not.toHaveBeenCalled();
	});
});
