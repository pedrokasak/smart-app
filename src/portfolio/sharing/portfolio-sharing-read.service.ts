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
			.sort({ date: 1, createdAt: 1 })
			.lean()
			.exec();
		return rows.map((t: any) => ({
			symbol: t.symbol,
			side: t.side,
			quantity: t.quantity,
			price: t.price,
			fees: t.fees ?? 0,
			date: new Date(t.date).toISOString().slice(0, 10),
			imported: !!t.uploadId,
			createdAt: t.createdAt,
		}));
	}
}
