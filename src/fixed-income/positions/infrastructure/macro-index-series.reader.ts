import { Injectable } from '@nestjs/common';
import { MacroSeriesService } from 'src/macro-indicators/application/macro-series.service';
import type { IndexSeries } from '../../domain/fixed-income.types';
import type { IndexSeriesReader } from '../application/fixed-income-positions.ports';

/**
 * CDI diário e IPCA mensal do espelho local das séries do BACEN (TRA-227).
 * O IPCA começa um mês antes: o pró-rata do primeiro mês precisa dele.
 */
@Injectable()
export class MacroIndexSeriesReader implements IndexSeriesReader {
	constructor(private readonly macroSeries: MacroSeriesService) {}

	async load(from: string, to: string): Promise<IndexSeries> {
		const [cdi, ipca] = await Promise.all([
			this.macroSeries.getSeries('CDI', from, to),
			this.macroSeries.getSeries('IPCA', monthBefore(from), to),
		]);
		return { cdiDaily: cdi.points, ipcaMonthly: ipca.points };
	}
}

function monthBefore(isoDate: string): string {
	const [year, month] = isoDate.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 2, 1));
	return date.toISOString().slice(0, 10);
}
