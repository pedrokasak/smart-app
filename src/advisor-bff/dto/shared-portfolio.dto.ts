import { ApiProperty } from '@nestjs/swagger';
import type { SharedPortfolioMetrics } from 'src/advisor/application/shared-portfolio.service';
import type { OwnedPortfolio } from 'src/advisor/application/ports/shared-portfolio-source.port';
import { MetricsResponseDto } from './metrics.dto';

export class SharedPortfolioResponseDto {
	@ApiProperty()
	id: string;

	@ApiProperty()
	name: string;

	static of(portfolio: OwnedPortfolio): SharedPortfolioResponseDto {
		return { id: portfolio.id, name: portfolio.name };
	}
}

export class SharedPortfolioMetricsResponseDto {
	@ApiProperty()
	portfolioId: string;

	@ApiProperty()
	name: string;

	@ApiProperty({ type: MetricsResponseDto })
	metrics: MetricsResponseDto;

	@ApiProperty({
		type: [String],
		description: 'Símbolos que a conciliação não conseguiu reproduzir',
	})
	unreconciledSymbols: string[];

	static of(item: SharedPortfolioMetrics): SharedPortfolioMetricsResponseDto {
		return {
			portfolioId: item.portfolioId,
			name: item.name,
			metrics: MetricsResponseDto.of(item.metrics),
			unreconciledSymbols: [...item.unreconciledSymbols],
		};
	}
}
