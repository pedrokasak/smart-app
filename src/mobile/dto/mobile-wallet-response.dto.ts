import { ApiProperty } from '@nestjs/swagger';

export class MobileWalletPositionDto {
	@ApiProperty()
	symbol: string;

	@ApiProperty({ type: String, nullable: true })
	name: string | null;

	@ApiProperty({ enum: ['stocks', 'crypto', 'fiis', 'other'] })
	bucket: string;

	@ApiProperty()
	quantity: number;

	@ApiProperty({ description: 'Valor a mercado, em reais' })
	value: number;

	@ApiProperty({ description: 'Custo de aquisição, em reais' })
	cost: number;

	@ApiProperty({
		type: Number,
		nullable: true,
		description: 'Resultado sobre o custo, em %',
	})
	resultPct: number | null;

	@ApiProperty({ description: 'Peso na carteira, de 0 a 100' })
	weightPct: number;

	@ApiProperty({ description: 'Peso acima do limite por ativo da política' })
	overLimit: boolean;
}

/** Posições de todas as carteiras, somadas por símbolo e ordenadas por valor. */
export class MobileWalletResponseDto {
	@ApiProperty({ description: 'Valor a mercado, em reais' })
	totalValue: number;

	@ApiProperty({ description: 'Custo de aquisição, em reais' })
	totalCost: number;

	@ApiProperty({ description: 'Valor menos custo, em reais' })
	result: number;

	@ApiProperty({ type: Number, nullable: true })
	resultPct: number | null;

	@ApiProperty({
		type: Number,
		nullable: true,
		description: 'Menor limite por ativo entre as carteiras com política, em %',
	})
	maxPositionPct: number | null;

	@ApiProperty({ type: MobileWalletPositionDto, isArray: true })
	positions: MobileWalletPositionDto[];
}

export class MobileDividendMonthDto {
	@ApiProperty({ example: '2026-11' })
	month: string;

	@ApiProperty({ description: 'Proventos recebidos no mês, em reais' })
	amount: number;
}

export class MobileDividendPayerDto {
	@ApiProperty()
	symbol: string;

	@ApiProperty({ description: 'Recebido em 12 meses, em reais' })
	amount: number;

	@ApiProperty({ description: 'Parte do total de 12 meses, em %' })
	sharePct: number;
}

export class MobileUpcomingDividendDto {
	@ApiProperty()
	symbol: string;

	@ApiProperty({ enum: ['JCP', 'DIVIDEND', 'RENDIMENTO', 'OTHER'] })
	paymentType: string;

	@ApiProperty({ example: '2026-11-24', description: 'Data prevista, em UTC' })
	paymentDate: string;

	@ApiProperty({ description: 'Valor por cota ou ação, em reais' })
	unitValue: number;

	@ApiProperty({ description: 'Valor líquido previsto, em reais' })
	netValue: number;
}

export class MobileUpcomingDividendsDto {
	@ApiProperty()
	totalNetValue: number;

	@ApiProperty({ type: MobileUpcomingDividendDto, isArray: true })
	items: MobileUpcomingDividendDto[];
}

export class MobileDividendInsightDto {
	@ApiProperty({ description: 'Leitura do Copiloto, com o número principal' })
	headline: string;

	@ApiProperty({ type: String, nullable: true })
	body: string | null;
}

export class MobileDividendsResponseDto {
	@ApiProperty({ description: 'Recebido nos últimos 12 meses, em reais' })
	received12m: number;

	@ApiProperty()
	monthlyAvg: number;

	@ApiProperty({ type: Number, nullable: true })
	yieldOnMarketPct: number | null;

	@ApiProperty({ type: Number, nullable: true })
	yieldOnCostPct: number | null;

	@ApiProperty({ description: 'Há posição mais nova que a janela de 12 meses' })
	approximated: boolean;

	@ApiProperty({
		type: MobileDividendMonthDto,
		isArray: true,
		description: '12 meses, do mais antigo ao atual',
	})
	months: MobileDividendMonthDto[];

	@ApiProperty({ type: MobileDividendPayerDto, isArray: true })
	payers: MobileDividendPayerDto[];

	@ApiProperty({ type: MobileUpcomingDividendsDto })
	upcoming: MobileUpcomingDividendsDto;

	@ApiProperty({ type: MobileDividendInsightDto })
	insight: MobileDividendInsightDto;
}
