import { ApiProperty } from '@nestjs/swagger';

export class MobileConfigResponseDto {
	@ApiProperty({
		description: 'Versão mínima aceita pela API',
		example: '1.0.0',
	})
	minVersion: string;
}

export class MobileHomePatrimonyDto {
	@ApiProperty({ description: 'Valor a mercado no último snapshot, em reais' })
	totalValue: number;

	@ApiProperty({
		type: Number,
		nullable: true,
		description: 'Retorno time-weighted em 12 meses, em fração',
	})
	twr12m: number | null;

	@ApiProperty({
		type: String,
		nullable: true,
		description: 'Data do snapshot',
	})
	asOf: string | null;

	@ApiProperty({
		description: 'Dias do período sem cotação de todos os ativos',
	})
	staleDays: number;
}

export class MobileHomeDividendsDto {
	@ApiProperty({
		description: 'Proventos líquidos anunciados até o fim do mês',
	})
	totalNetValue: number;

	@ApiProperty({ description: 'Quantidade de pagamentos previstos' })
	payments: number;
}

export class MobileHomeYieldDto {
	@ApiProperty({
		type: Number,
		nullable: true,
		description: 'Yield de 12 meses sobre o valor de mercado',
	})
	onMarket: number | null;

	@ApiProperty({
		type: Number,
		nullable: true,
		description: 'Yield de 12 meses sobre o custo',
	})
	onCost: number | null;

	@ApiProperty({
		description: 'Há posição mais nova que a janela de 12 meses',
	})
	approximated: boolean;
}

export class MobileHomeAllocationDto {
	@ApiProperty()
	bucket: string;

	@ApiProperty({ description: 'Percentual atual da carteira, de 0 a 100' })
	pct: number;
}

/**
 * Dados da tela inicial. Bloco que não pôde ser obtido vem `null`, com o motivo
 * em `unavailable`: a tela mostra o resto.
 */
export class MobileHomeResponseDto {
	@ApiProperty({ type: MobileHomePatrimonyDto, nullable: true })
	patrimony: MobileHomePatrimonyDto | null;

	@ApiProperty({ type: MobileHomeDividendsDto, nullable: true })
	dividends: MobileHomeDividendsDto | null;

	@ApiProperty({ type: MobileHomeYieldDto, nullable: true })
	yield: MobileHomeYieldDto | null;

	@ApiProperty({ type: MobileHomeAllocationDto, isArray: true, nullable: true })
	allocation: MobileHomeAllocationDto[] | null;

	@ApiProperty({ type: String, isArray: true })
	unavailable: string[];
}
