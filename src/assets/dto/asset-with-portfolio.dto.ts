import { AssetResponseDto } from 'src/assets/dto/asset-response.dto';

export class AssetWithPortfolioDto extends AssetResponseDto {
	portfolio: {
		id: string;
		name: string;
		ownerType: string;
	};
}
