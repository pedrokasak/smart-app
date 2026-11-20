import { Injectable } from '@nestjs/common';
import { PortfolioSharingReadService } from 'src/portfolio/sharing/portfolio-sharing-read.service';
import {
	SharedHoldingDto,
	SharedPortfolioDto,
	SharedTradeDto,
} from 'src/portfolio/sharing/shared-portfolio.dto';
import {
	OwnedPortfolio,
	SharedHolding,
	SharedPortfolioData,
	SharedPortfolioSourcePort,
	SharedTrade,
} from '../application/ports/shared-portfolio-source.port';
import { AssetClass, Provenance, TransactionSide } from '../domain/enums';

const ASSET_CLASSES: Readonly<Record<string, AssetClass>> = {
	stock: AssetClass.Stock,
	fii: AssetClass.Fii,
	etf: AssetClass.Etf,
	crypto: AssetClass.Crypto,
	fund: AssetClass.Fund,
	investment_fund: AssetClass.Fund,
	fixed_income: AssetClass.FixedIncome,
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const toAssetClass = (type: string): AssetClass =>
	ASSET_CLASSES[type] ?? AssetClass.Other;

const isPositive = (value: number): boolean =>
	Number.isFinite(value) && value > 0;

/** Reais em ponto flutuante viram centavos inteiros (o custo é o total da posição). */
const toMinor = (value: number): number => Math.round(value * 100);

/** `2030-02-31` não existe: o round trip pela data UTC o reprova. */
function isRealDay(day: string): boolean {
	if (typeof day !== 'string' || !ISO_DAY.test(day)) return false;
	const parsed = new Date(`${day}T00:00:00Z`);
	return (
		!Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day)
	);
}

function toHolding(h: SharedHoldingDto): SharedHolding | null {
	if (!isPositive(h.quantity) || !isPositive(h.unitCost)) return null;
	const costMinor = toMinor(h.quantity * h.unitCost);
	if (costMinor <= 0) return null;
	return {
		symbol: h.symbol,
		assetClass: toAssetClass(h.type),
		quantity: h.quantity,
		costMinor,
		provenance: h.source === 'b3' ? Provenance.Verified : Provenance.Manual,
	};
}

function toTrade(
	t: SharedTradeDto,
	classOf: ReadonlyMap<string, AssetClass>
): SharedTrade | null {
	if (!isPositive(t.quantity) || !isPositive(t.price) || !isRealDay(t.date)) {
		return null;
	}
	const unitPriceMinor = toMinor(t.price);
	if (unitPriceMinor <= 0) return null;
	return {
		symbol: t.symbol,
		assetClass: classOf.get(t.symbol) ?? AssetClass.Other,
		side: t.side === 'sell' ? TransactionSide.Sell : TransactionSide.Buy,
		quantity: t.quantity,
		unitPriceMinor,
		feesMinor: Number.isFinite(t.fees) && t.fees > 0 ? toMinor(t.fees) : 0,
		tradeDate: t.date,
		provenance: t.imported ? Provenance.Verified : Provenance.Manual,
		createdAt: t.createdAt,
	};
}

function toPortfolio(p: SharedPortfolioDto): SharedPortfolioData {
	const holdings = p.holdings
		.map(toHolding)
		.filter((h): h is SharedHolding => h !== null);
	// A negociação do B2C não traz a classe: herda a do ativo de mesmo símbolo.
	const classOf = new Map(holdings.map((h) => [h.symbol, h.assetClass]));
	return {
		portfolioId: p.id,
		name: p.name,
		holdings,
		trades: p.trades
			.map((t) => toTrade(t, classOf))
			.filter((t): t is SharedTrade => t !== null),
	};
}

/**
 * Converte os DTOs do leitor do B2C para o formato do advisor. O leitor já
 * só devolve carteiras do dono; aqui `userId` e ids passam sem alteração.
 * Linhas com número inválido são descartadas: nunca chegam NaN ao cálculo.
 */
@Injectable()
export class B2cSharedPortfolioSourceAdapter implements SharedPortfolioSourcePort {
	constructor(private readonly reader: PortfolioSharingReadService) {}

	async listOwned(userId: string): Promise<OwnedPortfolio[]> {
		const owned = await this.reader.listOwned(userId);
		return owned.map((p) => ({ id: p.id, name: p.name }));
	}

	async read(
		userId: string,
		portfolioIds: string[]
	): Promise<SharedPortfolioData[]> {
		const portfolios = await this.reader.readOwned(userId, portfolioIds);
		return portfolios.map(toPortfolio);
	}
}
