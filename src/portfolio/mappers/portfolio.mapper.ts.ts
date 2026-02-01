import { AssetMapper } from 'src/assets/mappers/asset.mapper';
import { Asset } from 'src/assets/schema/assets.model';
import { PortfolioResponseDto } from 'src/portfolio/dto/portfolio-response.dto';
import { PortfolioSummaryDto } from 'src/portfolio/dto/portfolio-summary.dto';
import { PortfolioWithAssetsDto } from 'src/portfolio/dto/portfolio-with-assets.dto';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';

export class PortfolioMapper {
	static toResponseDto(portfolio: Portfolio): PortfolioResponseDto {
		return {
			id: portfolio.id.toString(),
			userId: portfolio.userId.toString(),
			cpf: portfolio.cpf,
			name: portfolio.name,
			description: portfolio.description,
			ownerType: portfolio.ownerType,
			ownerName: portfolio.ownerName,
			totalValue: portfolio.totalValue,
			plan: portfolio.plan,
			assetCount: portfolio.assets.length,
			syncedWithB3At: portfolio.syncedWithB3At,
			createdAt: portfolio.createdAt,
			updatedAt: portfolio.updatedAt,
		};
	}

	static toResponseDtoWithAssets(
		portfolio: Portfolio,
		assets: any[]
	): PortfolioWithAssetsDto {
		return {
			id: portfolio.id.toString(),
			userId: portfolio.userId.toString(),
			cpf: portfolio.cpf,
			name: portfolio.name,
			description: portfolio.description,
			ownerType: portfolio.ownerType,
			ownerName: portfolio.ownerName,
			totalValue: portfolio.totalValue,
			plan: portfolio.plan,
			assetCount: assets.length,
			syncedWithB3At: portfolio.syncedWithB3At,
			createdAt: portfolio.createdAt,
			updatedAt: portfolio.updatedAt,
			assets: AssetMapper.toResponseDtoArray(assets),
		};
	}

	static toSummaryDto(
		portfolio: Portfolio,
		assets: Asset[]
	): PortfolioSummaryDto {
		const totalValue = assets.reduce((sum, asset) => sum + asset.total, 0);

		return {
			id: portfolio.id.toString(),
			name: portfolio.name,
			ownerType: portfolio.ownerType,
			ownerName: portfolio.ownerName,
			totalValue,
			assetCount: assets.length,
			plan: portfolio.plan,
			allocation: assets.map((asset) => ({
				symbol: asset.symbol,
				quantity: asset.quantity,
				percentage: totalValue > 0 ? (asset.total / totalValue) * 100 : 0,
			})),
		};
	}

	static toResponseDtoArray(portfolios: Portfolio[]): PortfolioResponseDto[] {
		return portfolios.map((portfolio) => this.toResponseDto(portfolio));
	}
}
