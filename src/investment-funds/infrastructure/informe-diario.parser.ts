import { normalizeCnpj } from '../domain/cnpj';
import { FundQuote, fundQuoteKey, isSameOrNewer } from '../domain/fund-quote';

/**
 * Cabeçalho do Informe Diário depois da RCVM 175 (conferido em 08/10/2026 no
 * `meta_inf_diario_fi.txt` e no arquivo de 09/2026). Coluna a mais, a menos ou
 * renomeada interrompe a leitura: gravar cota lida da coluna errada é pior do
 * que ficar com a cota de ontem.
 */
export const INFORME_DIARIO_HEADER = [
	'TP_FUNDO_CLASSE',
	'CNPJ_FUNDO_CLASSE',
	'ID_SUBCLASSE',
	'DT_COMPTC',
	'VL_TOTAL',
	'VL_QUOTA',
	'VL_PATRIM_LIQ',
	'CAPTC_DIA',
	'RESG_DIA',
	'NR_COTST',
] as const;

const COLUMN = Object.fromEntries(
	INFORME_DIARIO_HEADER.map((name, index) => [name, index])
) as Record<(typeof INFORME_DIARIO_HEADER)[number], number>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class InformeDiarioSchemaError extends Error {
	constructor(header: string) {
		super(`Cabeçalho do Informe Diário mudou: "${header.slice(0, 200)}"`);
		this.name = 'InformeDiarioSchemaError';
	}
}

export interface InformeDiarioSummary {
	quotes: FundQuote[];
	rows: number;
	invalidRows: number;
	/** Maior data de competência lida; `null` em arquivo sem linhas válidas. */
	latestDate: string | null;
}

function parseNumber(raw: string): number | null {
	if (!raw) return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

/**
 * Lê o CSV linha a linha e guarda só a última cota de cada classe/subclasse —
 * o arquivo do mês tem ~540 mil linhas, a carteira precisa de ~26 mil.
 *
 * Cota zero ou negativa (fundo com patrimônio negativo existe; foram 1.502
 * linhas em 09/2026) é guardada como veio: é o dado oficial do dia. Quem
 * marca a mercado é que se recusa a usar cota que não seja positiva.
 */
export class LatestFundQuoteAccumulator {
	private readonly latest = new Map<string, FundQuote>();
	private headerChecked = false;
	private rows = 0;
	private invalidRows = 0;
	private latestDate: string | null = null;

	pushLine(rawLine: string): void {
		const line = rawLine.replace(/\r$/, '');
		if (!line) return;

		if (!this.headerChecked) {
			if (line.replace(/^﻿/, '') !== INFORME_DIARIO_HEADER.join(';')) {
				throw new InformeDiarioSchemaError(line);
			}
			this.headerChecked = true;
			return;
		}

		this.rows += 1;
		const quote = this.parseRow(line.split(';'));
		if (!quote) {
			this.invalidRows += 1;
			return;
		}

		const key = fundQuoteKey(quote.cnpj, quote.subclassId);
		if (isSameOrNewer(quote, this.latest.get(key))) {
			this.latest.set(key, quote);
		}
		if (!this.latestDate || quote.date > this.latestDate) {
			this.latestDate = quote.date;
		}
	}

	result(): InformeDiarioSummary {
		if (!this.headerChecked) {
			throw new InformeDiarioSchemaError('(arquivo vazio)');
		}
		return {
			quotes: [...this.latest.values()],
			rows: this.rows,
			invalidRows: this.invalidRows,
			latestDate: this.latestDate,
		};
	}

	private parseRow(fields: string[]): FundQuote | null {
		if (fields.length !== INFORME_DIARIO_HEADER.length) return null;

		const cnpj = normalizeCnpj(fields[COLUMN.CNPJ_FUNDO_CLASSE]);
		const date = fields[COLUMN.DT_COMPTC].trim();
		const quota = parseNumber(fields[COLUMN.VL_QUOTA].trim());
		if (!cnpj || !ISO_DATE.test(date) || quota === null) return null;

		const investors = parseNumber(fields[COLUMN.NR_COTST].trim());
		return {
			cnpj,
			subclassId: fields[COLUMN.ID_SUBCLASSE].trim() || null,
			date,
			quota,
			netAssetValue: parseNumber(fields[COLUMN.VL_PATRIM_LIQ].trim()),
			investorCount:
				investors !== null && Number.isInteger(investors) && investors >= 0
					? investors
					: null,
		};
	}
}
