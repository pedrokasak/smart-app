import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { TradeDocument } from 'src/fiscal/schema/trade.model';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import {
	SharedHoldingDto,
	SharedPortfolioDto,
	SharedPortfolioSummaryDto,
	SharedTradeDto,
} from './shared-portfolio.dto';

// Só os campos que os DTOs usam: o resto do documento (indicadores,
// histórico de dividendos, dados pessoais) nunca sai do banco.
const PORTFOLIO_FIELDS = { _id: 1, name: 1 };
const ASSET_FIELDS = {
	symbol: 1,
	type: 1,
	quantity: 1,
	price: 1,
	avgPrice: 1,
	source: 1,
};
const TRADE_FIELDS = {
	symbol: 1,
	side: 1,
	quantity: 1,
	price: 1,
	fees: 1,
	date: 1,
	uploadId: 1,
	createdAt: 1,
};

/**
 * Leitura somente-leitura das carteiras B2C de um investidor, para o módulo
 * advisor. É o único ponto que toca `Portfolio`, `Asset` e `Trade` para
 * compartilhamento e devolve DTOs puros. Nunca escreve nas coleções.
 */
@Injectable()
export class PortfolioSharingReadService {
	constructor(
		@InjectModel('Portfolio') private readonly portfolioModel: Model<Portfolio>,
		@InjectModel('Asset') private readonly assetModel: Model<Asset>,
		@InjectModel('Trade') private readonly tradeModel: Model<TradeDocument>
	) {}

	async listOwned(userId: string): Promise<SharedPortfolioSummaryDto[]> {
		if (!Types.ObjectId.isValid(userId)) return [];
		const rows = await this.portfolioModel
			.find({ userId: new Types.ObjectId(userId) })
			.select(PORTFOLIO_FIELDS)
			.sort({ createdAt: 1 })
			.lean()
			.exec();
		return rows.map((p: any) => ({ id: String(p._id), name: p.name }));
	}

	async readOwned(
		userId: string,
		portfolioIds: string[]
	): Promise<SharedPortfolioDto[]> {
		if (!Types.ObjectId.isValid(userId)) return [];
		const ids = portfolioIds
			.filter((id) => Types.ObjectId.isValid(id))
			.map((id) => new Types.ObjectId(id));
		if (ids.length === 0) return [];

		const owner = new Types.ObjectId(userId);
		const portfolios = await this.portfolioModel
			.find({ _id: { $in: ids }, userId: owner })
			.select(PORTFOLIO_FIELDS)
			.sort({ createdAt: 1 })
			.lean()
			.exec();

		return Promise.all(
			portfolios.map(async (p: any): Promise<SharedPortfolioDto> => {
				const [holdings, trades] = await Promise.all([
					this.readHoldings(p._id),
					this.readTrades(owner, p._id),
				]);
				return { id: String(p._id), name: p.name, holdings, trades };
			})
		);
	}

	private async readHoldings(
		portfolioId: Types.ObjectId
	): Promise<SharedHoldingDto[]> {
		const rows = await this.assetModel
			.find({ portfolioId, quantity: { $gt: 0 } })
			.select(ASSET_FIELDS)
			.sort({ symbol: 1 })
			.lean()
			.exec();
		return rows.map((a: any) => ({
			symbol: a.symbol,
			type: a.type,
			quantity: a.quantity,
			unitCost: a.avgPrice > 0 ? a.avgPrice : a.price,
			source: a.source,
		}));
	}

	private async readTrades(
		userId: Types.ObjectId,
		portfolioId: Types.ObjectId
	): Promise<SharedTradeDto[]> {
		const rows = await this.tradeModel
			.find({ userId, portfolioId })
			.select(TRADE_FIELDS)
			.sort({ date: 1, createdAt: 1 })
			.lean()
			.exec();
		// Linha com data inválida é ignorada: uma linha ruim nunca derruba a
		// leitura inteira (toISOString lançaria RangeError).
		return rows.flatMap((t: any): SharedTradeDto[] => {
			const date = t.date == null ? null : new Date(t.date);
			if (!date || Number.isNaN(date.getTime())) return [];
			return [
				{
					symbol: t.symbol,
					side: t.side,
					quantity: t.quantity,
					price: t.price,
					fees: t.fees ?? 0,
					date: date.toISOString().slice(0, 10),
					imported: !!t.uploadId,
					createdAt: t.createdAt,
				},
			];
		});
	}
}
