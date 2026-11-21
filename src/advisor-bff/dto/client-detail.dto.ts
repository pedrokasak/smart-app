import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PortfolioProvenance } from 'src/advisor/domain/enums';
import type { ClientSummary } from 'src/advisor/application/client-directory.service';
import type { Wealth, WealthPart } from '../wealth-summary.assembler';
import { ClientSummaryResponseDto } from './client.dto';

export class WealthPartResponseDto {
	@ApiProperty({ enum: ['ADVISOR_LEDGER', 'B2C_SHARED'] })
	source: WealthPart['source'];

	@ApiProperty({ enum: PortfolioProvenance, nullable: true })
	provenance: PortfolioProvenance | null;

	@ApiProperty({
		type: Number,
		nullable: true,
		description: 'Valor de mercado em centavos; nulo se a parte falhou',
	})
	valueMinor: number | null;

	@ApiPropertyOptional({ enum: ['METRICS_UNAVAILABLE'] })
	unavailableReason?: 'METRICS_UNAVAILABLE';
}

export class WealthResponseDto {
	@ApiProperty({ enum: ['BRL'] })
	currency: 'BRL';

	@ApiProperty({ description: 'YYYY-MM-DD' })
	asOf: string;

	@ApiProperty({
		type: Number,
		nullable: true,
		description:
			'Soma das partes com valor, em centavos; nulo se nenhuma tiver valor',
	})
	totalMinor: number | null;

	@ApiProperty({ description: 'Alguma parte ficou fora da soma' })
	totalIsPartial: boolean;

	@ApiProperty({ type: [WealthPartResponseDto] })
	parts: WealthPartResponseDto[];
}

export class ClientDetailResponseDto extends ClientSummaryResponseDto {
	@ApiProperty({ type: WealthResponseDto })
	wealth: WealthResponseDto;

	static detailOf(
		summary: ClientSummary,
		wealth: Wealth
	): ClientDetailResponseDto {
		return {
			...ClientSummaryResponseDto.of(summary),
			wealth: {
				currency: wealth.currency,
				asOf: wealth.asOf,
				totalMinor: wealth.totalMinor,
				totalIsPartial: wealth.totalIsPartial,
				parts: wealth.parts.map((p) => ({
					source: p.source,
					provenance: p.provenance,
					valueMinor: p.valueMinor,
					...(p.unavailableReason && {
						unavailableReason: p.unavailableReason,
					}),
				})),
			},
		};
	}
}
