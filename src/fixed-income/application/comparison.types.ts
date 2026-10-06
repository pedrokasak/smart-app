import type { Analysis } from '../domain/comparison-analysis';
import type { Offer } from '../domain/offer';
import type { SimulatedInstrument } from '../domain/simulation';
import type { MarketRate } from './fixed-income-rates.service';

export interface ComparisonRequest {
	/** Valor aplicado, em R$. */
	principal: number;
	/** Prazo em anos (aceita fração). */
	years: number;
	/** Sobrescreve o CDI de mercado, em % a.a. */
	cdiPct?: number;
	/** Sobrescreve o IPCA de mercado, em % a.a. */
	ipcaPct?: number;
	offers?: Offer[];
	/** Títulos do Tesouro escolhidos à mão; ausente = seleção automática pelo prazo. */
	tesouroIds?: string[];
}

export interface AssumptionValue {
	valuePct: number;
	/** `market` = lido do BACEN; `user` = digitado por quem simula. */
	source: 'market' | 'user';
	asOf?: string;
}

export interface ComparisonRow extends SimulatedInstrument {
	/** Maior retorno real do cenário. */
	isBest: boolean;
}

export interface ComparisonResult {
	scenario: {
		principal: number;
		years: number;
		days: number;
		horizonEnd: string;
		/** Alíquota do IR regressivo para o prazo, em %. */
		irRatePct: number;
		cdi: AssumptionValue;
		ipca: AssumptionValue;
	};
	rows: ComparisonRow[];
	analysis: Analysis;
	warnings: string[];
	selicMeta: MarketRate | null;
	tesouro: {
		baseDate: string;
		fetchedAt: string;
		stale: boolean;
		sourceUrl: string;
	} | null;
}

/**
 * CDI ou IPCA sem leitura de mercado e sem valor informado: o cálculo não
 * pode seguir, porque o único substituto seria um número inventado.
 */
export class MarketRateUnavailableError extends Error {
	constructor(readonly field: 'cdi' | 'ipca') {
		super(
			field === 'cdi'
				? 'CDI indisponível no momento. Informe o CDI manualmente para simular.'
				: 'IPCA indisponível no momento. Informe o IPCA manualmente para simular.'
		);
	}
}
