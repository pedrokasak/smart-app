import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Formato único de erro do BFF. `reason` vem de uma lista fechada por rota;
 * `details` é tipado por `reason`: `CSV_REJECTED` e `INVALID_TRANSACTION`
 * trazem `{ errors }` (linhas `{ line, code }` ou regras violadas),
 * `OVERSELL` traz `{ symbol, tradeDate }`.
 */
export class ErrorResponseDto {
	@ApiProperty({ example: 404 })
	statusCode: number;

	@ApiProperty({ example: 'NOT_FOUND' })
	error: string;

	@ApiPropertyOptional({ example: 'ALREADY_OWNS_ORGANIZATION' })
	reason?: string;

	@ApiPropertyOptional({
		type: 'object',
		additionalProperties: true,
		description:
			'Detalhes tipados por `reason`: `{ errors }` para CSV_REJECTED e ' +
			'INVALID_TRANSACTION; `{ symbol, tradeDate }` para OVERSELL.',
	})
	details?: Record<string, unknown>;
}
