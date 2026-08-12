import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
	IsEmail,
	IsMongoId,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
} from 'class-validator';

const UTM_PATTERN = /^[\w.-]+$/;
const UTM_MESSAGE =
	'Use apenas letras, números, ponto, hífen ou underscore (máx. 64)';

export class PurchaseIntentDto {
	@ApiProperty({
		description: 'E-mail do visitante interessado no plano',
		example: 'investidor@example.com',
	})
	@IsEmail({}, { message: 'Informe um e-mail válido' })
	email: string;

	@ApiProperty({
		description: 'Id do plano que gerou o interesse',
		example: '6995af0198591333bb0d4862',
	})
	@IsMongoId({ message: 'Plano inválido' })
	planId: string;

	@ApiPropertyOptional({ description: 'Origem da campanha (utm_source)' })
	@IsOptional()
	@IsString()
	@MaxLength(64, { message: UTM_MESSAGE })
	@Matches(UTM_PATTERN, { message: UTM_MESSAGE })
	utmSource?: string;

	@ApiPropertyOptional({ description: 'Meio da campanha (utm_medium)' })
	@IsOptional()
	@IsString()
	@MaxLength(64, { message: UTM_MESSAGE })
	@Matches(UTM_PATTERN, { message: UTM_MESSAGE })
	utmMedium?: string;

	@ApiPropertyOptional({ description: 'Nome da campanha (utm_campaign)' })
	@IsOptional()
	@IsString()
	@MaxLength(64, { message: UTM_MESSAGE })
	@Matches(UTM_PATTERN, { message: UTM_MESSAGE })
	utmCampaign?: string;
}
