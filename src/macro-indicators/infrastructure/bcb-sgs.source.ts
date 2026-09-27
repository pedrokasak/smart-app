import { Injectable } from '@nestjs/common';
import type {
	MacroSeriesPoint,
	MacroSeriesSource,
} from '../application/macro-series.ports';
import type { SeriesDescriptor } from '../domain/series-catalog';
import { fetchSgsDailySeries } from './bcb-sgs/bcb-sgs-series';

const toUtcDate = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);

/**
 * Adaptador do SGS. O fatiamento em janelas de 3 anos (TRA-226) vale para
 * qualquer periodicidade: o limite de 10 anos só morde série diária, mas
 * fatiar série mensal custa pouco e mantém um caminho só.
 */
@Injectable()
export class BcbSgsSource implements MacroSeriesSource {
	fetch(
		descriptor: SeriesDescriptor,
		from: string,
		to: string
	): Promise<MacroSeriesPoint[]> {
		return fetchSgsDailySeries(
			descriptor.code,
			toUtcDate(from),
			toUtcDate(to),
			{
				seriesStart: toUtcDate(descriptor.seriesStart),
			}
		);
	}
}
