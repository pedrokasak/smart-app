import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Asset } from 'src/assets/schema/assets.model';
import type {
	FundHoldingPriceWriter,
	StoredFundQuote,
} from '../application/ports/investment-funds.ports';
import { INVESTMENT_FUND_ASSET_TYPE } from '../domain/investment-fund-asset';
import { isPlausibleQuote } from '../domain/quote-plausibility';

export const CVM_QUOTE_SOURCE = 'cvm-informe-diario';

/**
 * Leva a última cota da CVM para as posições `investment_fund` (TRA-276),
 * como a varredura de cotações faz com ações (TRA-247). Histórico da
 * carteira, digest e relatórios leem `currentPrice` direto do ativo.
 *
 * Cota não positiva ou implausível para o preço informado (ver
 * `isPlausibleQuote`) não é gravada: a posição fica com o preço da pessoa.
 */
@Injectable()
export class MongoFundHoldingPriceWriter implements FundHoldingPriceWriter {
	constructor(
		@InjectModel('Asset') private readonly assetModel: Model<Asset>
	) {}

	async heldCnpjs(): Promise<string[]> {
		const symbols = await this.assetModel
			.distinct('symbol', { type: INVESTMENT_FUND_ASSET_TYPE })
			.exec();
		return symbols.map(String);
	}

	async applyQuotes(quotes: StoredFundQuote[]): Promise<number> {
		const byCnpj = new Map(
			quotes
				.filter((quote) => !quote.subclassId && quote.quota > 0)
				.map((quote) => [quote.cnpj, quote])
		);
		if (!byCnpj.size) return 0;

		const holdings = await this.assetModel
			.find(
				{
					type: INVESTMENT_FUND_ASSET_TYPE,
					symbol: { $in: [...byCnpj.keys()] },
				},
				{ symbol: 1, price: 1 }
			)
			.lean()
			.exec();

		const operations = holdings.flatMap((holding: any) => {
			const quote = byCnpj.get(String(holding.symbol));
			if (!quote || !isPlausibleQuote(Number(holding.price), quote.quota)) {
				return [];
			}
			return [
				{
					updateOne: {
						filter: { _id: holding._id },
						update: {
							$set: {
								currentPrice: quote.quota,
								currentPriceAt: new Date(`${quote.date}T00:00:00-03:00`),
								currentPriceSource: CVM_QUOTE_SOURCE,
							},
						},
					},
				},
			];
		});
		if (!operations.length) return 0;

		const result = await this.assetModel.bulkWrite(operations as any, {
			ordered: false,
		});
		return Number(result?.modifiedCount) || 0;
	}
}
