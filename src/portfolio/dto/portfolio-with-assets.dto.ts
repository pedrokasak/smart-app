import { PortfolioResponseDto } from 'src/portfolio/dto/portfolio-response.dto';
import { AssetResponseDto } from '../../assets/dto/asset-response.dto';

export class PortfolioWithAssetsDto extends PortfolioResponseDto {
	assets: AssetResponseDto[];
}
