import { IsNumber, Min, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateAssetDto } from 'src/assets/dto/create-asset.dto';

export class UpdateAssetDto extends PartialType(CreateAssetDto) {
	@IsOptional()
	@IsNumber()
	@Min(0.00001)
	quantity?: number;

	@IsOptional()
	@IsNumber()
	@Min(0.01)
	price?: number;
}
