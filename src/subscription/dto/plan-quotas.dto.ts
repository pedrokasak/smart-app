import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

const QUOTA_DOC =
	'Limite de itens do plano. `null` = ilimitado; ausente = padrão do nível de acesso.';

/**
 * Cotas editáveis no admin (TRA-197). `null` é um valor válido e significa
 * ilimitado, por isso `@IsOptional` (que também libera `null`).
 */
export class PlanQuotasDto {
	@ApiPropertyOptional({ description: QUOTA_DOC, nullable: true })
	@IsOptional()
	@IsInt()
	@Min(0)
	assets?: number | null;

	@ApiPropertyOptional({ description: QUOTA_DOC, nullable: true })
	@IsOptional()
	@IsInt()
	@Min(0)
	portfolios?: number | null;

	@ApiPropertyOptional({ description: QUOTA_DOC, nullable: true })
	@IsOptional()
	@IsInt()
	@Min(0)
	broker_connections?: number | null;
}
