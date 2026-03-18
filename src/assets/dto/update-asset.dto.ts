import { IsNumber, Min, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
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

	@IsOptional()
	@IsNumber()
	@Min(0)
	avgPrice?: number;

	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => DividendHistoryItemDto)
	dividendHistory?: DividendHistoryItemDto[];
}

export class DividendHistoryItemDto {
	@IsNumber()
	value: number;

	date: Date;
}
