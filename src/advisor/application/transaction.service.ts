import {
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
	UnprocessableEntityException,
} from '@nestjs/common';
import { Provenance, TransactionSource } from '../domain/enums';
import { Transaction, TransactionInput } from '../domain/portfolio.entities';
import {
	DerivedPortfolio,
	derivePositions,
	findOversell,
} from '../domain/positions';
import {
	normalizeSymbol,
	TransactionRuleError,
	validateTransactionInput,
} from '../domain/transaction-rules';
import { ADVISOR_TRANSACTION_STORE } from './advisor.tokens';
import { AccessContext, AuthorizationService } from './authorization.service';
import type { TransactionStorePort } from './ports/transaction.store.port';

export class InvalidTransactionError extends UnprocessableEntityException {
	constructor(errors: TransactionRuleError[]) {
		super({ errors });
	}
}

export class OversellError extends UnprocessableEntityException {
	constructor(detail: { symbol: string; tradeDate: string }) {
		super({ symbol: detail.symbol, tradeDate: detail.tradeDate });
	}
}

@Injectable()
export class TransactionService {
	constructor(
		private readonly authorization: AuthorizationService,
		@Inject(ADVISOR_TRANSACTION_STORE)
		private readonly transactions: TransactionStorePort
	) {}

	async addManual(
		ctx: AccessContext,
		clientProfileId: string,
		input: TransactionInput
	): Promise<Transaction> {
		await this.authorization.ensureCanAccessClient(
			ctx,
			clientProfileId,
			'EDIT_POSITION'
		);

		const normalized: TransactionInput = {
			...input,
			symbol:
				typeof input.symbol === 'string'
					? normalizeSymbol(input.symbol)
					: input.symbol,
		};
		const errors = validateTransactionInput(
			normalized,
			new Date().toISOString().slice(0, 10)
		);
		if (errors.length > 0) throw new InvalidTransactionError(errors);

		const ledger = await this.transactions.listByClient(
			ctx.orgId,
			clientProfileId
		);
		const oversell = findOversell([
			...ledger,
			{ ...normalized, createdAt: new Date() },
		]);
		if (oversell) throw new OversellError(oversell);

		const [created] = await this.transactions.createMany([
			{
				symbol: normalized.symbol,
				assetClass: normalized.assetClass,
				side: normalized.side,
				quantity: normalized.quantity,
				unitPriceMinor: normalized.unitPriceMinor,
				feesMinor: normalized.feesMinor,
				currency: normalized.currency,
				tradeDate: normalized.tradeDate,
				...(normalized.liquidityDays !== undefined && {
					liquidityDays: normalized.liquidityDays,
				}),
				orgId: ctx.orgId,
				clientProfileId,
				provenance: Provenance.Manual,
				source: TransactionSource.ManualEntry,
				createdByUserId: ctx.userId,
			},
		]);
		return created;
	}

	/** Só remove MANUAL; VERIFIED vem de importação e fica imutável. */
	async removeManual(
		ctx: AccessContext,
		clientProfileId: string,
		transactionId: string
	): Promise<void> {
		await this.authorization.ensureCanAccessClient(
			ctx,
			clientProfileId,
			'EDIT_POSITION'
		);

		const target = await this.transactions.findById(
			ctx.orgId,
			clientProfileId,
			transactionId
		);
		if (!target) throw new NotFoundException('Transaction not found');
		if (target.provenance === Provenance.Verified) {
			throw new ForbiddenException('Verified transactions cannot be removed');
		}

		const ledger = await this.transactions.listByClient(
			ctx.orgId,
			clientProfileId
		);
		const oversell = findOversell(ledger.filter((t) => t.id !== target.id));
		if (oversell) throw new OversellError(oversell);

		await this.transactions.deleteById(ctx.orgId, clientProfileId, target.id);
	}

	async listTransactions(
		ctx: AccessContext,
		clientProfileId: string
	): Promise<Transaction[]> {
		await this.authorization.ensureCanAccessClient(
			ctx,
			clientProfileId,
			'VIEW_PORTFOLIO'
		);
		return this.transactions.listByClient(ctx.orgId, clientProfileId);
	}

	async getPositions(
		ctx: AccessContext,
		clientProfileId: string
	): Promise<DerivedPortfolio> {
		const ledger = await this.listTransactions(ctx, clientProfileId);
		return derivePositions(ledger);
	}
}
