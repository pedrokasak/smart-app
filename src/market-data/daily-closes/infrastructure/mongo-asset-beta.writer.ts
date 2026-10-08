import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { AssetBetaWrite, AssetBetaWriter } from '../application/ports';

/**
 * Grava o beta em campos próprios do ativo, e não em `indicators.beta`:
 * `enrichAsset` troca `indicators` inteiro a cada enriquecimento e apagaria
 * o número calculado aqui. O mapper expõe como `indicators.beta`.
 */
@Injectable()
export class MongoAssetBetaWriter implements AssetBetaWriter {
	constructor(@InjectModel('Asset') private readonly assets: Model<Asset>) {}

	async write(betas: AssetBetaWrite[]): Promise<number> {
		if (!betas.length) return 0;
		const result = await this.assets.bulkWrite(
			betas.map(({ symbol, beta, asOf, benchmark }) => ({
				updateMany: {
					filter: { symbol, type: { $in: ['stock', 'fii', 'etf'] } },
					update: {
						$set: { beta, betaAsOf: asOf, betaBenchmark: benchmark },
					},
				},
			})) as any,
			{ ordered: false }
		);
		return Number(result?.modifiedCount) || 0;
	}
}
