import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
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

// Um UTM inválido não deve derrubar a captura do lead: com
// forbidNonWhitelisted, um erro de validação rejeita a requisição inteira.
// Em vez disso, descartamos o valor inválido (vira undefined) e deixamos o
// lead ser registrado sem atribuição. Perder a origem é aceitável; perder o
// lead não.
function sanitizeUtmValue({ value }: { value: unknown }): string | undefined {
	if (typeof value !== 'string') return undefined;
	if (value.length > 64) return undefined;
	if (!UTM_PATTERN.test(value)) return undefined;
	return value;
}

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
	@Transform(sanitizeUtmValue)
	@IsString()
	@MaxLength(64, { message: UTM_MESSAGE })
	@Matches(UTM_PATTERN, { message: UTM_MESSAGE })
	utmSource?: string;

	@ApiPropertyOptional({ description: 'Meio da campanha (utm_medium)' })
	@IsOptional()
	@Transform(sanitizeUtmValue)
	@IsString()
	@MaxLength(64, { message: UTM_MESSAGE })
	@Matches(UTM_PATTERN, { message: UTM_MESSAGE })
	utmMedium?: string;

	@ApiPropertyOptional({ description: 'Nome da campanha (utm_campaign)' })
	@IsOptional()
	@Transform(sanitizeUtmValue)
	@IsString()
	@MaxLength(64, { message: UTM_MESSAGE })
	@Matches(UTM_PATTERN, { message: UTM_MESSAGE })
	utmCampaign?: string;
}
