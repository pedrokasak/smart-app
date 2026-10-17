import {
	BadRequestException,
	Inject,
	Injectable,
	Logger,
	Optional,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { todayInSaoPaulo } from 'src/macro-indicators/application/macro-series.service';
import { FIXED_INCOME_CLOCK } from '../../application/fixed-income-clock';
import {
	CURVE_PRICE_SOURCE,
	FIXED_INCOME_ASSET_TYPE,
} from '../../domain/fixed-income-asset';
import type {
	FixedIncomePosition,
	FixedIncomeValuation,
} from '../../domain/fixed-income.types';
import { positionName, positionSymbol } from '../../domain/position-naming';
import { valuePosition } from '../../domain/position-valuation';
import {
	FIXED_INCOME_HOLDINGS,
	FIXED_INCOME_INDEX_SERIES,
	FIXED_INCOME_PORTFOLIO_ACCESS,
	FixedIncomeHoldingsStore,
	IndexSeriesReader,
	PortfolioAccess,
} from './fixed-income-positions.ports';

/**
 * Posições de renda fixa na carteira (TRA-230, fase 2): cadastro e marcação
 * diária na curva. O valor marcado vai para `currentPrice`/`total` do ativo,
 * que é o que o resto do sistema já lê.
 */
@Injectable()
export class FixedIncomePositionsService {
	private readonly logger = new Logger(FixedIncomePositionsService.name);

	constructor(
		@Inject(FIXED_INCOME_PORTFOLIO_ACCESS)
		private readonly portfolio: PortfolioAccess,
		@Inject(FIXED_INCOME_INDEX_SERIES)
		private readonly series: IndexSeriesReader,
		@Inject(FIXED_INCOME_HOLDINGS)
		private readonly holdings: FixedIncomeHoldingsStore,
		@Optional()
		@Inject(FIXED_INCOME_CLOCK)
		private readonly clock?: () => Date
	) {}

	async create(
		userId: string,
		portfolioId: string,
		position: FixedIncomePosition
	) {
		await this.portfolio.assertOwnership(userId, portfolioId);
		const now = this.now();
		const today = todayInSaoPaulo(now);
		assertCoherent(position, today);

		const valuation = valuePosition(
			position,
			today,
			await this.series.load(position.appliedAt, today)
		);
		const value = valuation?.grossValue ?? position.principal;
		const suffix = new Types.ObjectId().toHexString().slice(-6);

		return this.portfolio.insertAsset(portfolioId, {
			symbol: positionSymbol(position, suffix),
			name: positionName(position),
			type: FIXED_INCOME_ASSET_TYPE,
			quantity: 1,
			price: position.principal,
			avgPrice: position.principal,
			total: value,
			currentPrice: value,
			// Sem marcação (série ainda não carregada) fica sem data: o valor é
			// só o aplicado, e o job diário completa.
			...(valuation ? { currentPriceAt: now } : {}),
			currentPriceSource: CURVE_PRICE_SOURCE,
			fixedIncome: { ...position, valuation },
		});
	}

	/** Marca todas as posições. Chamado pelo job diário; nunca lança. */
	async markAll(): Promise<number> {
		try {
			const holdings = await this.holdings.listAll();
			if (!holdings.length) return 0;

			const now = this.now();
			const today = todayInSaoPaulo(now);
			const from = holdings
				.map((holding) => holding.position.appliedAt)
				.reduce((min, date) => (date < min ? date : min));
			const series = await this.series.load(from, today);

			const items: { id: string; valuation: FixedIncomeValuation }[] = [];
			for (const holding of holdings) {
				const valuation = valuePosition(holding.position, today, series);
				if (valuation) items.push({ id: holding.id, valuation });
			}
			const written = await this.holdings.applyValuations(items, now);
			const skipped = holdings.length - items.length;
			if (skipped > 0) {
				this.logger.warn(
					`${skipped} posição(ões) de renda fixa sem série para marcar.`
				);
			}
			return written;
		} catch (error) {
			this.logger.error(
				`Falha na marcação da renda fixa: ${(error as Error)?.message || error}`
			);
			return 0;
		}
	}

	private now(): Date {
		return this.clock ? this.clock() : new Date();
	}
}

/** Faixa da taxa por indexador: o DTO só barra o absurdo. */
const RATE_RANGE: Record<FixedIncomePosition['indexer'], [number, number]> = {
	PERCENT_CDI: [1, 300],
	CDI_PLUS: [-5, 5],
	PREFIXED: [0, 100],
	IPCA_PLUS: [-5, 30],
};

/** Regras que olham mais de um campo. */
function assertCoherent(position: FixedIncomePosition, today: string): void {
	const [min, max] = RATE_RANGE[position.indexer];
	if (position.ratePct < min || position.ratePct > max) {
		throw new BadRequestException(
			`Taxa fora da faixa para este indexador (${min} a ${max}).`
		);
	}
	if (position.appliedAt > today) {
		throw new BadRequestException('A data da aplicação não pode ser futura.');
	}
	if (position.maturityDate && position.maturityDate <= position.appliedAt) {
		throw new BadRequestException(
			'O vencimento precisa ser depois da aplicação.'
		);
	}
	if (position.kind === 'TESOURO' && position.indexer === 'PERCENT_CDI') {
		throw new BadRequestException(
			'Tesouro não rende % do CDI: use Selic, prefixado ou IPCA+.'
		);
	}
	if (position.kind !== 'TESOURO' && position.indexer === 'CDI_PLUS') {
		throw new BadRequestException(
			'Selic + spread é só do Tesouro Selic; para papel de banco use % do CDI.'
		);
	}
}
