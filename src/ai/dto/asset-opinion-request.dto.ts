import { IsString, MinLength } from 'class-validator';

export class AssetOpinionRequestDto {
	@IsString()
	@MinLength(1)
	symbol: string;
}
