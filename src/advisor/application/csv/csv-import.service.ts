import { createHash } from 'node:crypto';
import {
	ConflictException,
	Inject,
	Injectable,
	Logger,
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
import { OversellError } from '../transaction.service';
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
	private readonly logger = new Logger(CsvImportService.name);

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
				throw new ConflictException({ reason: 'DUPLICATE_IMPORT' });
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
			try {
				await this.transactions.discardImport(
					ctx.orgId,
					clientProfileId,
					importBatchId
				);
			} catch (discardError) {
				// O erro original sempre vence; o lote fica PENDING e é retomado
				// depois de STALE_IMPORT_MS.
				this.logger.error(
					`discardImport failed after createMany failed: ${
						(discardError as Error)?.name ?? 'unknown error'
					}`
				);
			}
			throw error;
		}
		await this.transactions.completeImport(
			ctx.orgId,
			clientProfileId,
			importBatchId
		);
		return { importBatchId, imported: items.length };
	}

	/**
	 * Desfaz um import inteiro. Recusa (OversellError, nada removido) se tirar as
	 * linhas do lote deixar descoberta uma venda que fica no livro. Lote
	 * desconhecido remove 0, mas o discard ainda libera um hash preso.
	 */
	async revertImport(
		ctx: AccessContext,
		clientProfileId: string,
		importBatchId: string
	): Promise<{ removed: number }> {
		await this.authorization.ensureCanAccessClient(
			ctx,
			clientProfileId,
			'EDIT_POSITION'
		);

		const ledger = await this.transactions.listByClient(
			ctx.orgId,
			clientProfileId
		);
		const removed = ledger.filter((t) => t.importBatchId === importBatchId);
		const remaining = ledger.filter((t) => t.importBatchId !== importBatchId);
		for (const symbol of new Set(removed.map((t) => t.symbol))) {
			const oversell = findOversell(
				remaining.filter((t) => t.symbol === symbol)
			);
			if (oversell) throw new OversellError(oversell);
		}

		await this.transactions.discardImport(
			ctx.orgId,
			clientProfileId,
			importBatchId
		);
		return { removed: removed.length };
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
			const fileSells = fileRows.filter(
				(r) => r.input.side === TransactionSide.Sell
			);
			// O SELL reportado pode ser um já gravado (venda do arquivo retroativa
			// que consome o saldo dele): cai no último SELL do arquivo até a data.
			const culprit =
				fileSells.find((r) => r.input.tradeDate === oversell.tradeDate) ??
				fileSells
					.filter((r) => r.input.tradeDate <= oversell.tradeDate)
					.sort((a, b) =>
						b.input.tradeDate.localeCompare(a.input.tradeDate)
					)[0];
			errors.push({
				line: culprit?.line ?? 1,
				code: 'INVALID_QUANTITY',
			});
		}
		return errors.sort((a, b) => a.line - b.line);
	}
}
