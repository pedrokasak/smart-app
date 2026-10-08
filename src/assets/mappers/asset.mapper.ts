import { AssetResponseDto } from 'src/assets/dto/asset-response.dto';
import { Asset } from 'src/assets/schema/assets.model';

export class AssetMapper {
	static toResponseDto(asset: Asset): AssetResponseDto {
		return {
			id: asset._id.toString(),
			portfolioId: asset.portfolioId.toString(),
			symbol: asset.symbol,
			name: (asset as any).name ?? undefined,
			// Sem repassar aqui, o setor persistido nunca chega ao front — que já
			// agrupa a exposição por `a.sector` (TRA-144).
			sector: asset.sector ?? null,
			type: asset.type,
			quantity: asset.quantity,
			price: asset.price,
			avgPrice: (asset as any).avgPrice ?? undefined,
			total: asset.total,
			currentPrice: asset.currentPrice,
			currentPriceAt: (asset as any).currentPriceAt ?? undefined,
			change24h: asset.change24h,
			dividendHistory: (asset as any).dividendHistory ?? undefined,
			indicators: AssetMapper.indicatorsWithBeta(asset),
			betaBenchmark: asset.betaBenchmark ?? undefined,
			betaAsOf: asset.betaAsOf ?? undefined,
			source: asset.source,
			lastEnrichedAt: asset.lastEnrichedAt,
			createdAt: asset.createdAt,
			updatedAt: asset.updatedAt,
		};
	}

	/**
	 * O beta mora em campo próprio do ativo (o enriquecimento troca
	 * `indicators` inteiro), mas o contrato com o front é `indicators.beta`.
	 * Sem beta calculado devolve `indicators` como está.
	 */
	private static indicatorsWithBeta(
		asset: Asset
	): AssetResponseDto['indicators'] {
		const base = asset.indicators as AssetResponseDto['indicators'];
		if (typeof asset.beta !== 'number') return base;
		return { ...base, beta: asset.beta };
	}

	static toResponseDtoArray(assets: Asset[]): AssetResponseDto[] {
		return assets.map((asset) => this.toResponseDto(asset));
	}
}
