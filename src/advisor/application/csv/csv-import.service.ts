import { createHash } from 'node:crypto';
import {
	ConflictException,
	Inject,
	Injectable,
	UnprocessableEntityException,
} from '@nestjs/common';
import {
	Provenance,
	TransactionSide,
	TransactionSource,
} from '../../domain/enums';
import { NewTransaction } from '../../domain/portfolio.entities';
import { findOversell } from '../../domain/positions';
import { ADVISOR_TRANSACTION_STORE } from '../advisor.tokens';
import { AccessContext, AuthorizationService } from '../authorization.service';
import {
	DuplicateImportError,
	type TransactionStorePort,
} from '../ports/transaction.store.port';
import {
	CSV_MAX_BYTES,
	CsvParsedRow,
	CsvRowError,
	parseAdvisorCsvDetailed,
} from './advisor-csv.parser';

export class CsvRejectedError extends UnprocessableEntityException {
	constructor(errors: CsvRowError[]) {
		super({ errors });
	}
}

export interface CsvImportResult {
	importBatchId: string;
	imported: number;
}

@Injectable()
export class CsvImportService {
	constructor(
		private readonly authorization: AuthorizationService,
		@Inject(ADVISOR_TRANSACTION_STORE)
		private readonly transactions: TransactionStorePort
	) {}

	async importCsv(
		ctx: AccessContext,
		clientProfileId: string,
		csvText: string
	): Promise<CsvImportResult> {
		await this.authorization.ensureCanAccessClient(
			ctx,
			clientProfileId,
			'EDIT_POSITION'
		);

		if (Buffer.byteLength(csvText) > CSV_MAX_BYTES) {
			throw new CsvRejectedError([{ line: 1, code: 'FILE_TOO_LARGE' }]);
		}

		const parsed = parseAdvisorCsvDetailed(
			csvText,
			new Date().toISOString().slice(0, 10)
		);
		if ('errors' in parsed) throw new CsvRejectedError(parsed.errors);

		const oversellErrors = await this.findOversellErrors(
			ctx,
			clientProfileId,
			parsed.rows
		);
		if (oversellErrors.length > 0) throw new CsvRejectedError(oversellErrors);

		const sourceHash = createHash('sha256').update(csvText).digest('hex');
		let importBatchId: string;
		try {
			importBatchId = await this.transactions.claimImport(
				ctx.orgId,
				clientProfileId,
				sourceHash,
				ctx.userId
			);
		} catch (error) {
			if (error instanceof DuplicateImportError) {
				throw new ConflictException('This file was already imported');
			}
			throw error;
		}

		const items: NewTransaction[] = parsed.rows.map(({ input }) => ({
			...input,
			orgId: ctx.orgId,
			clientProfileId,
			provenance: Provenance.Verified,
			source: TransactionSource.CsvImport,
			importBatchId,
			createdByUserId: ctx.userId,
		}));
		try {
			await this.transactions.createMany(items);
		} catch (error) {
			await this.transactions.discardImport(
				ctx.orgId,
				clientProfileId,
				importBatchId
			);
			throw error;
		}
		return { importBatchId, imported: items.length };
	}

	/** Por símbolo do arquivo: livro gravado do símbolo + linhas do arquivo. */
	private async findOversellErrors(
		ctx: AccessContext,
		clientProfileId: string,
		rows: CsvParsedRow[]
	): Promise<CsvRowError[]> {
		const ledger = await this.transactions.listByClient(
			ctx.orgId,
			clientProfileId
		);
		const importedAt = new Date();
		const errors: CsvRowError[] = [];
		for (const symbol of new Set(rows.map((r) => r.input.symbol))) {
			const fileRows = rows.filter((r) => r.input.symbol === symbol);
			const oversell = findOversell([
				...ledger.filter((t) => t.symbol === symbol),
				...fileRows.map((r) => ({ ...r.input, createdAt: importedAt })),
			]);
			if (!oversell) continue;
			const culprit = fileRows.find(
				(r) =>
					r.input.side === TransactionSide.Sell &&
					r.input.tradeDate === oversell.tradeDate
			);
			errors.push({
				line: culprit?.line ?? 1,
				code: 'INVALID_QUANTITY',
			});
		}
		return errors.sort((a, b) => a.line - b.line);
	}
}
