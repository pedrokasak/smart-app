import {
	inflationOverPeriod,
	realReturn,
} from 'src/macro-indicators/domain/compounding';
import { annualize } from 'src/portfolio/history/returns';
import type { InflationSeries } from './inflation.port';

export const REAL_RETURN_CONVENTION = 'fisher_geometric_ipca_pro_rata' as const;

export interface RealReturnResult {
	/** Retorno real do período, em FRAÇÃO: `(1 + TWR) / (1 + IPCA) − 1`. */
	value: number | null;
	annualized: number | null;
	/** IPCA acumulado no período, em FRAÇÃO. */
	inflation: number | null;
	/** Meses sem IPCA publicado, estimados pelo último IPCA divulgado. */
	estimatedMonths: number;
	lastPublishedMonth: string | null;
	/**
	 * Como o número foi calculado — o retorno real é derivado, não publicado
	 * por ninguém: IPCA encadeado, mês parcial pró-rata geométrico por dias
	 * corridos, deflacionado pela fórmula de Fisher.
	 */
	convention: typeof REAL_RETURN_CONVENTION;
	source: {
		series: 'BACEN_SGS_433';
		extractedAt: string | null;
		url: string;
		license: 'ODbL-1.0';
	} | null;
}

const EMPTY: RealReturnResult = {
	value: null,
	annualized: null,
	inflation: null,
	estimatedMonths: 0,
	lastPublishedMonth: null,
	convention: REAL_RETURN_CONVENTION,
	source: null,
};

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * Primeiro dia do mês, dois meses antes de `from`: garante um IPCA publicado
 * para servir de estimativa mesmo se o mês de início ainda não saiu.
 */
export function ipcaLookupStart(from: string): string {
	const [year, month] = from.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1 - 2, 1));
	return date.toISOString().slice(0, 10);
}

export function buildRealReturn(params: {
	twr: number | null;
	from: string | null;
	to: string | null;
	ipca: InflationSeries | null;
}): RealReturnResult {
	const { twr, from, to, ipca } = params;
	if (twr === null || !from || !to || !ipca) return EMPTY;

	const period = inflationOverPeriod(ipca.points, from, to);
	if (!period) return EMPTY;

	const value = round6(realReturn(twr, period.inflation));
	const days =
		(new Date(`${to}T00:00:00.000Z`).getTime() -
			new Date(`${from}T00:00:00.000Z`).getTime()) /
		(24 * 60 * 60 * 1000);

	return {
		value,
		annualized: annualize(value, days),
		inflation: round6(period.inflation),
		estimatedMonths: period.estimatedMonths,
		lastPublishedMonth: period.lastPublishedMonth,
		convention: REAL_RETURN_CONVENTION,
		source: {
			series: 'BACEN_SGS_433',
			extractedAt: ipca.extractedAt ? ipca.extractedAt.toISOString() : null,
			url: ipca.sourceUrl,
			license: 'ODbL-1.0',
		},
	};
}
