import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class UpdateFeaturesDto {
	@ApiProperty({
		example: ['Nova feature 1', 'Nova feature 2'],
		description: 'Lista de funcionalidades do plano',
	})
	@IsArray()
	@IsString({ each: true })
	features: string[];
}
