import {
	TESOURO_CSV_TYPES,
	type TesouroTitle,
	tesouroTitleId,
	tesouroTitleName,
} from '../domain/tesouro-title';

/** Cabeçalho do CSV "Taxas dos Títulos Ofertados pelo Tesouro Direto". */
export const TESOURO_CSV_HEADER =
	'Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha';

export class TesouroCsvFormatError extends Error {}

/** DD/MM/AAAA → AAAA-MM-DD; `null` se não for uma data de calendário. */
function parseBrDate(value: string): string | null {
	const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
	if (!match) return null;
	const [, day, month, year] = match;
	const iso = `${year}-${month}-${day}`;
	const parsed = new Date(`${iso}T00:00:00.000Z`);
	return Number.isNaN(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== iso
		? null
		: iso;
}

/** "13,83" → 13.83; `null` se vazio ou não numérico. */
function parseBrNumber(value: string): number | null {
	const text = value.trim();
	if (!/^\d+(,\d+)?$/.test(text)) return null;
	return Number(text.replace(',', '.'));
}

/**
 * Uma linha do CSV como título, ou `null` quando não serve: tipo fora dos três
 * suportados (ver tesouro-title.ts), campo faltando ou valor ilegível. Linha
 * ruim nunca vira número inventado.
 */
export function parseTesouroCsvLine(line: string): TesouroTitle | null {
	const cells = line.split(';');
	if (cells.length < 8) return null;

	const csvType = cells[0].trim();
	const family = TESOURO_CSV_TYPES[csvType];
	if (!family) return null;

	const maturityDate = parseBrDate(cells[1]);
	const baseDate = parseBrDate(cells[2]);
	const buyRatePct = parseBrNumber(cells[3]);
	const sellRatePct = parseBrNumber(cells[4]);
	const unitPrice = parseBrNumber(cells[5]);
	if (
		!maturityDate ||
		!baseDate ||
		buyRatePct === null ||
		sellRatePct === null ||
		unitPrice === null
	) {
		return null;
	}

	return {
		id: tesouroTitleId(family, maturityDate),
		family,
		name: tesouroTitleName(csvType, maturityDate),
		maturityDate,
		buyRatePct,
		sellRatePct,
		unitPrice,
		baseDate,
	};
}

/**
 * Lê o CSV linha a linha e guarda só o pregão mais recente, sem depender da
 * ordem do arquivo e sem manter as ~177 mil linhas em memória.
 *
 * O cabeçalho é conferido: se o Tesouro mudar as colunas, falha alto em vez de
 * ler lixo como se fosse taxa.
 */
export class LatestTesouroAccumulator {
	private headerSeen = false;
	private latestBaseDate = '';
	private titles = new Map<string, TesouroTitle>();

	pushLine(rawLine: string): void {
		const line = rawLine.replace(/\r$/, '');
		if (!line.trim()) return;

		if (!this.headerSeen) {
			if (line.replace(/^﻿/, '').trim() !== TESOURO_CSV_HEADER) {
				throw new TesouroCsvFormatError(
					'Cabeçalho do CSV do Tesouro mudou; leitura recusada.'
				);
			}
			this.headerSeen = true;
			return;
		}

		const title = parseTesouroCsvLine(line);
		if (!title || title.baseDate < this.latestBaseDate) return;

		if (title.baseDate > this.latestBaseDate) {
			this.latestBaseDate = title.baseDate;
			this.titles = new Map();
		}
		this.titles.set(title.id, title);
	}

	result(): { baseDate: string; titles: TesouroTitle[] } | null {
		if (!this.headerSeen) {
			throw new TesouroCsvFormatError('CSV do Tesouro vazio.');
		}
		if (this.titles.size === 0) return null;
		return {
			baseDate: this.latestBaseDate,
			titles: [...this.titles.values()],
		};
	}
}
