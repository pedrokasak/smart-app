import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { issuerBaseCode } from 'src/ri-intelligence/domain/issuer-base-code';
import {
	RiHolder,
	RiHolderDirectory,
} from 'src/ri-intelligence/watch/application/ports/ri-holder-directory.port';

function normalizeTicker(value: unknown): string {
	return String(value ?? '')
		.trim()
		.toUpperCase()
		.replace(/\.SA$/, '');
}

// A regra mora no dominio (TRA-264): a pergunta do chat tambem precisa dela.
export { issuerBaseCode };

/** Detentores a partir das posicoes e das carteiras (TRA-261). */
@Injectable()
export class MongoRiHolderDirectory implements RiHolderDirectory {
	constructor(
		@InjectModel('Asset') private readonly assetModel: Model<Asset>,
		@InjectModel('Portfolio')
		private readonly portfolioModel: Model<Portfolio>
	) {}

	async holdersOfIssuer(ticker: string): Promise<RiHolder[]> {
		const base = issuerBaseCode(ticker);
		if (!base) return [];

		// Prefixo ancorado: usa o indice de `symbol`. `base` so tem [A-Z0-9].
		const assets = await this.assetModel
			.find({
				symbol: { $regex: `^${base}\\d{1,2}(\\.SA)?$` },
				// Posicao zerada nao e posicao: quem vendeu nao recebe aviso.
				quantity: { $gt: 0 },
				// FII entra com a FundosNet (TRA-266). O codigo de negociacao e
				// unico na B3: acao e FII nunca dividem a base.
				type: { $in: ['stock', 'fii'] },
			})
			.select('portfolioId symbol')
			.lean<{ portfolioId: Types.ObjectId; symbol: string }[]>();
		if (!assets.length) return [];

		const portfolioIds = [
			...new Set(assets.map((asset) => String(asset.portfolioId))),
		].map((id) => new Types.ObjectId(id));
		const portfolios = await this.portfolioModel
			.find({ _id: { $in: portfolioIds } })
			.select('_id userId')
			.lean<{ _id: Types.ObjectId; userId: Types.ObjectId }[]>();
		const ownerOf = new Map(
			portfolios.map((portfolio) => [
				String(portfolio._id),
				String(portfolio.userId),
			])
		);

		const tickersByUser = new Map<string, Set<string>>();
		for (const asset of assets) {
			const userId = ownerOf.get(String(asset.portfolioId));
			if (!userId) continue;
			const tickers = tickersByUser.get(userId) ?? new Set<string>();
			tickers.add(normalizeTicker(asset.symbol));
			tickersByUser.set(userId, tickers);
		}

		// Um aviso por usuario, mesmo com duas carteiras ou duas classes.
		return [...tickersByUser.entries()]
			.map(([userId, tickers]) => ({ userId, ticker: [...tickers].sort()[0] }))
			.sort((a, b) => a.userId.localeCompare(b.userId));
	}
}
