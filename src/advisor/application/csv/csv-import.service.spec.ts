import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditTrail } from 'src/audit/application/audit-trail.port';
import { AuditEventInput } from 'src/audit/domain/audit-event';
import { OrgRole, Provenance, TransactionSource } from '../../domain/enums';
import { AuthorizationService } from '../authorization.service';
import {
	InMemoryMembershipStore,
	InMemoryRelationshipStore,
	InMemoryTransactionStore,
} from '../in-memory-stores.fixture';
import { RelationshipService } from '../relationship.service';
import { TransactionService } from '../transaction.service';
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
		relationships = new InMemoryRelationshipStore();
		rel = new RelationshipService(relationships);
		transactions = new InMemoryTransactionStore();
		const authz = new AuthorizationService(
			memberships,
			relationships,
			new FakeAuditTrail()
		);
		service = new CsvImportService(authz, transactions);
		manual = new TransactionService(authz, transactions);
		await memberships.create({ userId, orgId: 'orgA', role: OrgRole.Advisor });
		await rel.create('orgA', 'clientA');
		await rel.create('orgA', 'clientC');
		await rel.create('orgB', 'clientB');
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
