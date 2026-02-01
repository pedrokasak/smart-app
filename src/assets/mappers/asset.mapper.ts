import { AssetResponseDto } from 'src/assets/dto/asset-response.dto';
import { Asset } from 'src/assets/schema/assets.model';

export class AssetMapper {
	static toResponseDto(asset: Asset): AssetResponseDto {
		return {
			id: asset._id.toString(),
			portfolioId: asset.portfolioId.toString(),
			symbol: asset.symbol,
			type: asset.type,
			quantity: asset.quantity,
			price: asset.price,
			total: asset.total,
			currentPrice: asset.currentPrice,
			change24h: asset.change24h,
			indicators: asset.indicators,
			source: asset.source,
			lastEnrichedAt: asset.lastEnrichedAt,
			createdAt: asset.createdAt,
			updatedAt: asset.updatedAt,
		};
	}

	static toResponseDtoArray(assets: Asset[]): AssetResponseDto[] {
		return assets.map((asset) => this.toResponseDto(asset));
	}
}
