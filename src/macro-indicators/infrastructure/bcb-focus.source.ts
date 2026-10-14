import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { InflationExpectationsSource } from '../application/inflation-expectations.port';
import type { InflationExpectations } from '../domain/inflation-expectations';
import { TtlPromiseCache } from './bcb-sgs/ttl-promise-cache';

const FOCUS_BASE_URL =
	'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata';
const FOCUS_TIMEOUT_MS = 15_000;
/** A pesquisa sai uma vez por dia útil: seis horas de reuso bastam. */
const FOCUS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Cinco anos-calendário por pesquisa, com folga para duas datas. */
const ANNUAL_ROWS = 12;
/** `baseCalculo` 0 = respostas dos últimos 30 dias (a série de referência). */
const BASE_30_DAYS = 0;

interface AnnualRow {
	Data: string;
	DataReferencia: string;
	Mediana: number;
}

interface TwelveMonthsRow {
	Data: string;
	Mediana: number;
}

/** Linhas da pesquisa anual mais recente, como `{ ano: mediana }`. */
export function latestAnnualSurvey(
	rows: AnnualRow[]
): { surveyDate: string; byYear: Record<number, number> } | null {
	const valid = rows.filter(
		(row) =>
			typeof row?.Data === 'string' &&
			Number.isFinite(Number(row?.DataReferencia)) &&
			Number.isFinite(row?.Mediana)
	);
	if (!valid.length) return null;
	const surveyDate = valid
		.map((row) => row.Data)
		.sort()
		.at(-1) as string;
	const byYear: Record<number, number> = {};
	for (const row of valid) {
		if (row.Data === surveyDate) {
			byYear[Number(row.DataReferencia)] = row.Mediana;
		}
	}
	return { surveyDate, byYear };
}

/**
 * Expectativas de IPCA do Focus (API Olinda do BACEN): a mediana para os
 * próximos 12 meses e por ano-calendário. Falha vira `null` e um aviso no
 * log; quem usa decide o substituto (hoje, o IPCA realizado de 12 meses).
 */
@Injectable()
export class BcbFocusSource implements InflationExpectationsSource {
	private readonly logger = new Logger(BcbFocusSource.name);
	private readonly cache = new TtlPromiseCache<InflationExpectations>(
		FOCUS_CACHE_TTL_MS,
		1
	);

	async latest(): Promise<InflationExpectations | null> {
		try {
			return await this.cache.getOrLoad('ipca', () => this.load());
		} catch (error) {
			this.logger.warn(
				`Focus indisponível: ${(error as Error)?.message || error}`
			);
			return null;
		}
	}

	private async load(): Promise<InflationExpectations> {
		const [annual, twelveMonths] = await Promise.all([
			this.get<AnnualRow>('ExpectativasMercadoAnuais', {
				$filter: `Indicador eq 'IPCA' and baseCalculo eq ${BASE_30_DAYS}`,
				$orderby: 'Data desc',
				$top: String(ANNUAL_ROWS),
				$select: 'Data,DataReferencia,Mediana',
			}),
			this.get<TwelveMonthsRow>('ExpectativasMercadoInflacao12Meses', {
				$filter: `Indicador eq 'IPCA' and Suavizada eq 'S' and baseCalculo eq ${BASE_30_DAYS}`,
				$orderby: 'Data desc',
				$top: '1',
				$select: 'Data,Mediana',
			}),
		]);

		const survey = latestAnnualSurvey(annual);
		const next12m = twelveMonths[0];
		if (!survey || !next12m || !Number.isFinite(next12m.Mediana)) {
			throw new Error('resposta do Focus sem IPCA');
		}
		return {
			surveyDate:
				next12m.Data > survey.surveyDate ? next12m.Data : survey.surveyDate,
			next12mPct: next12m.Mediana,
			byYear: survey.byYear,
			source: 'BCB_FOCUS',
		};
	}

	private async get<T>(
		resource: string,
		params: Record<string, string>
	): Promise<T[]> {
		const response = await axios.get<{ value?: T[] }>(
			`${FOCUS_BASE_URL}/${resource}`,
			{
				params: { ...params, $format: 'json' },
				timeout: FOCUS_TIMEOUT_MS,
			}
		);
		return Array.isArray(response.data?.value) ? response.data.value : [];
	}
}
