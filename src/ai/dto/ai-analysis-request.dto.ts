import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class AiAnalysisRequestDto {
	@ApiProperty({ description: 'ID do usuário a ser analisado' })
	@IsString()
	@IsOptional()
	userId?: string;
}
