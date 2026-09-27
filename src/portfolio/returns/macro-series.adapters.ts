import { Injectable } from '@nestjs/common';
import { MacroSeriesService } from 'src/macro-indicators/application/macro-series.service';
import type { InflationPort, InflationSeries } from './inflation.port';
import type { RiskFreeRatePort } from './risk-free-rate.port';

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * CDI do Sharpe servido pelo espelho local das séries do BACEN (TRA-227), em
 * vez de uma ida ao BACEN por cálculo de retorno.
 */
@Injectable()
export class MacroRiskFreeRateAdapter implements RiskFreeRatePort {
	constructor(private readonly macroSeries: MacroSeriesService) {}

	async getCdiSeries(
		from: Date,
		to: Date
	): Promise<{ series: Array<{ date: string; value: number }> }> {
		const { points } = await this.macroSeries.getSeries(
			'CDI',
			isoDate(from),
			isoDate(to)
		);
		return { series: points };
	}
}

@Injectable()
export class MacroInflationAdapter implements InflationPort {
	constructor(private readonly macroSeries: MacroSeriesService) {}

	async getMonthlyIpca(from: string, to: string): Promise<InflationSeries> {
		const { points, extractedAt, sourceUrl } = await this.macroSeries.getSeries(
			'IPCA',
			from,
			to
		);
		return { points, extractedAt, sourceUrl };
	}
}
