import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
	IsArray,
	IsIn,
	IsNumber,
	IsObject,
	IsOptional,
	IsString,
	Max,
	Min,
	ValidateNested,
} from 'class-validator';

/**
 * Espelho do contrato `/api/insights` do trackerr-ia (TRA-56/133).
 *
 * O trackerr-ia passou a devolver insights com evidencia deterministica,
 * confianca calculada, acao com rota e fontes RAG consultadas. O server
 * apenas repassa o payload ao `web` — nao inventa nem preenche campos
 * ausentes. `title` e `body` seguem sendo os campos legados que o front
 * ja consome; os novos campos abaixo sao TODOS opcionais em runtime, para
 * preservar compatibilidade com respostas antigas (a shape antiga vira
 * subconjunto valido desta).
 *
 * Ver `trackerr-ia/models/models.py::Insight` para o contrato canonico.
 */

export class InsightEvidenceDto {
	@ApiProperty({ description: 'Rotulo curto do ponto de evidencia.' })
	@IsString()
	label!: string;

	// `value` pode ser numero, string ou booleano — reflete o `Any` do Pydantic.
	// Deixado sem `@IsX` a proposito: validar tipo aqui obrigaria a divergir
	// do contrato original, que e polimorfico.
	@ApiProperty({
		description: 'Valor bruto do ponto de evidencia. Tipo livre.',
	})
	value!: unknown;

	@ApiPropertyOptional({
		description: 'Id do fato de entrada (ex.: "exposure.cripto").',
	})
	@IsOptional()
	@IsString()
	source?: string;
}

export class InsightConfidenceDto {
	@ApiProperty({ minimum: 0, maximum: 1 })
	@IsNumber()
	@Min(0)
	@Max(1)
	value!: number;

	@ApiProperty({ enum: ['baixa', 'media', 'alta'] })
	@IsIn(['baixa', 'media', 'alta'])
	bucket!: 'baixa' | 'media' | 'alta';

	@ApiProperty({ description: 'Justificativa curta da confianca calculada.' })
	@IsString()
	reason!: string;
}

export class InsightActionDto {
	@ApiProperty({ description: 'Rotulo do CTA exibido ao usuario.' })
	@IsString()
	label!: string;

	@ApiProperty({ description: 'Rota do front-end acionada pelo CTA.' })
	@IsString()
	route!: string;

	@ApiPropertyOptional({
		description: 'Parametros passados a rota alvo. Estrutura livre.',
		type: Object,
	})
	@IsOptional()
	@IsObject()
	payload?: Record<string, unknown>;

	@ApiPropertyOptional({ description: 'Motivo do CTA, mostrado ao usuario.' })
	@IsOptional()
	@IsString()
	why?: string;
}

export class InsightSourceDto {
	@ApiPropertyOptional() @IsOptional() @IsString() source_type?: string;
	@ApiPropertyOptional() @IsOptional() @IsString() source_id?: string;
	@ApiPropertyOptional() @IsOptional() @IsString() knowledge_base?: string;
	// `as_of` vem como string ISO (Pydantic serializa `date` assim). Nao
	// convertemos a Date pra evitar timezone drift entre server e web.
	@ApiPropertyOptional({ description: 'Data ISO (YYYY-MM-DD) do chunk RAG.' })
	@IsOptional()
	@IsString()
	as_of?: string;
}

export class InsightDto {
	@ApiProperty() @IsString() id!: string;

	@ApiProperty() @IsString() title!: string;

	@ApiProperty({ description: 'Corpo curto (legado). Mantido por BC.' })
	@IsString()
	body!: string;

	// Campos novos (TRA-56): todos opcionais para aceitar payload legado como
	// subconjunto valido. Quando o trackerr-ia emitir a versao completa, o web
	// renderiza; caso contrario, cai no legado (title/body).
	@ApiPropertyOptional()
	@IsOptional()
	@IsString()
	rationale?: string;

	@ApiPropertyOptional({ type: [InsightEvidenceDto] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => InsightEvidenceDto)
	evidence?: InsightEvidenceDto[];

	@ApiPropertyOptional({ type: InsightConfidenceDto })
	@IsOptional()
	@ValidateNested()
	@Type(() => InsightConfidenceDto)
	confidence?: InsightConfidenceDto;

	@ApiPropertyOptional({ type: InsightActionDto })
	@IsOptional()
	@ValidateNested()
	@Type(() => InsightActionDto)
	action?: InsightActionDto;

	@ApiPropertyOptional({ type: [InsightSourceDto] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => InsightSourceDto)
	sources?: InsightSourceDto[];
}

export class InsightsResponseDto {
	@ApiProperty({ type: [InsightDto] })
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => InsightDto)
	insights!: InsightDto[];
}

/**
 * Corpo do POST /ai/insights. Reflete `InsightsRequest` do trackerr-ia
 * (user_profile + data_freshness_days). Tipagem propositalmente frouxa em
 * `user_profile` para acompanhar o passthrough ja adotado em /ai/analyze.
 */
export class InsightsRequestDto {
	@ApiProperty({
		description:
			'Payload UserProfile do trackerr-ia (user_id, profile_plan, portfolio, etc.).',
		type: Object,
	})
	@IsObject()
	user_profile!: Record<string, unknown>;

	@ApiPropertyOptional({
		description: 'Idade maxima aceitavel dos chunks RAG usados, em dias.',
	})
	@IsOptional()
	@IsNumber()
	data_freshness_days?: number;
}
