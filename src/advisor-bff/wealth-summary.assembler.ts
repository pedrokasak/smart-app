import { Injectable, Logger } from '@nestjs/common';
import {
	ClientActionForbiddenError,
	ClientNotAccessibleError,
} from 'src/advisor/application/access-errors';
import type { AccessContext } from 'src/advisor/application/authorization.service';
import type { ClientSummary } from 'src/advisor/application/client-directory.service';
import { PortfolioMetricsService } from 'src/advisor/application/metrics/portfolio-metrics.service';
import {
	NoActiveConsentError,
	SharedPortfolioService,
} from 'src/advisor/application/shared-portfolio.service';
import { TransactionService } from 'src/advisor/application/transaction.service';
import { PortfolioProvenance, ProfileOrigin } from 'src/advisor/domain/enums';

export type WealthSource = 'ADVISOR_LEDGER' | 'B2C_SHARED';

export interface WealthPart {
	source: WealthSource;
	provenance: PortfolioProvenance | null;
	valueMinor: number | null;
	unavailableReason?: 'METRICS_UNAVAILABLE';
}

export interface Wealth {
	currency: 'BRL';
	/** YYYY-MM-DD */
	asOf: string;
	totalMinor: number | null;
	totalIsPartial: boolean;
	parts: WealthPart[];
}

/** Resultado de uma origem: a parte (se existir) e a data do cálculo. */
interface PartResult {
	part: WealthPart | null;
	asOf?: string;
}

/** Do mais fraco ao mais forte; `null` conta como `MANUAL`. */
const STRENGTH: Record<PortfolioProvenance, number> = {
	[PortfolioProvenance.Manual]: 0,
	[PortfolioProvenance.Partial]: 1,
	[PortfolioProvenance.Verified]: 2,
};

const weakest = (
	seals: Array<PortfolioProvenance | null>
): PortfolioProvenance => {
	const normalized = seals.map((s) => s ?? PortfolioProvenance.Manual);
	return normalized.reduce((min, s) => (STRENGTH[s] < STRENGTH[min] ? s : min));
};

/** Erros de acesso nunca viram "parte indisponível": o pedido inteiro falha. */
const isAccessError = (error: unknown): boolean =>
	error instanceof ClientNotAccessibleError ||
	error instanceof ClientActionForbiddenError;

/**
 * Monta o patrimônio do cliente (decisão U1): uma parte por origem, nunca
 * misturadas numa métrica só, e o total somado. Só valor de mercado; nada de
 * rentabilidade ou risco do total.
 */
@Injectable()
export class WealthSummaryAssembler {
	private readonly logger = new Logger(WealthSummaryAssembler.name);

	constructor(
		private readonly transactions: TransactionService,
		private readonly metrics: PortfolioMetricsService,
		private readonly shared: SharedPortfolioService
	) {}

	async build(ctx: AccessContext, client: ClientSummary): Promise<Wealth> {
		const [ledger, sharedResult] = await Promise.all([
			this.ledgerPart(ctx, client),
			this.sharedPart(ctx, client),
		]);
		const results = [ledger, sharedResult];
		const parts = results.flatMap((r) => (r.part ? [r.part] : []));
		const valued = parts.filter((p) => p.valueMinor !== null);

		return {
			currency: 'BRL',
			asOf:
				results.find((r) => r.asOf)?.asOf ??
				new Date().toISOString().slice(0, 10),
			totalMinor:
				parts.length === 0
					? 0
					: valued.length === 0
						? null
						: valued.reduce((sum, p) => sum + (p.valueMinor ?? 0), 0),
			totalIsPartial: valued.length < parts.length,
			parts,
		};
	}

	private async ledgerPart(
		ctx: AccessContext,
		client: ClientSummary
	): Promise<PartResult> {
		if (client.origin !== ProfileOrigin.AdvisorCreated) return { part: null };
		try {
			const ledger = await this.transactions.listTransactions(ctx, client.id);
			if (ledger.length === 0) return { part: null };
			const metrics = await this.metrics.getMetrics(ctx, client.id);
			return {
				asOf: metrics.asOf,
				part: {
					source: 'ADVISOR_LEDGER',
					provenance: metrics.provenance,
					valueMinor: metrics.totalValueMinor,
				},
			};
		} catch (error) {
			return this.unavailable('ADVISOR_LEDGER', client.id, error);
		}
	}

	private async sharedPart(
		ctx: AccessContext,
		client: ClientSummary
	): Promise<PartResult> {
		try {
			const portfolios = await this.shared.getSharedMetrics(ctx, client.id);
			if (portfolios.length === 0) return { part: null };
			return {
				asOf: portfolios[0].metrics.asOf,
				part: {
					source: 'B2C_SHARED',
					provenance: weakest(portfolios.map((p) => p.metrics.provenance)),
					valueMinor: portfolios.reduce(
						(sum, p) => sum + p.metrics.totalValueMinor,
						0
					),
				},
			};
		} catch (error) {
			if (error instanceof NoActiveConsentError) return { part: null };
			return this.unavailable('B2C_SHARED', client.id, error);
		}
	}

	/** Falha inesperada de uma origem não esconde a outra; acesso propaga. */
	private unavailable(
		source: WealthSource,
		clientId: string,
		error: unknown
	): PartResult {
		if (isAccessError(error)) throw error;
		// Só id e classe do erro: a mensagem pode carregar dado do cliente.
		this.logger.warn(
			`wealth part ${source} unavailable for client ${clientId}: ${
				error instanceof Error ? error.constructor.name : 'UnknownError'
			}`
		);
		return {
			part: {
				source,
				provenance: null,
				valueMinor: null,
				unavailableReason: 'METRICS_UNAVAILABLE',
			},
		};
	}
}
