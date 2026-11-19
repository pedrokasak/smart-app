import { AssetClass, TransactionSide } from '../../domain/enums';
import { TransactionInput } from '../../domain/portfolio.entities';
import {
	normalizeSymbol,
	TransactionRuleError,
	validateTransactionInput,
} from '../../domain/transaction-rules';

export const CSV_MAX_BYTES = 1_048_576;
export const CSV_MAX_ROWS = 5000;
const MAX_REPORTED_ERRORS = 100;

export type CsvErrorCode =
	| TransactionRuleError
	| 'MISSING_COLUMN'
	| 'EMPTY_FILE'
	| 'TOO_MANY_ROWS'
	| 'FILE_TOO_LARGE'
	| 'WRONG_COLUMN_COUNT';

export interface CsvRowError {
	line: number;
	code: CsvErrorCode;
	column?: string;
}

export type CsvParseResult =
	| { ok: true; rows: TransactionInput[] }
	| { ok: false; errors: CsvRowError[] };

export interface CsvParsedRow {
	line: number;
	input: TransactionInput;
}

export type CsvDetailedParseResult =
	| { ok: true; rows: CsvParsedRow[] }
	| { ok: false; errors: CsvRowError[] };

const REQUIRED_COLUMNS = [
	'data',
	'ativo',
	'classe',
	'lado',
	'quantidade',
	'preco',
	'taxas',
] as const;
const OPTIONAL_COLUMNS = ['liquidez_dias'] as const;

const ASSET_CLASS_ALIASES: Record<string, AssetClass> = {
	ACAO: AssetClass.Stock,
	FII: AssetClass.Fii,
	ETF: AssetClass.Etf,
	CRIPTO: AssetClass.Crypto,
	FUNDO: AssetClass.Fund,
	RENDA_FIXA: AssetClass.FixedIncome,
	OUTRO: AssetClass.Other,
	...Object.fromEntries(Object.values(AssetClass).map((v) => [v, v])),
};

const SIDE_ALIASES: Record<string, TransactionSide> = {
	C: TransactionSide.Buy,
	COMPRA: TransactionSide.Buy,
	BUY: TransactionSide.Buy,
	V: TransactionSide.Sell,
	VENDA: TransactionSide.Sell,
	SELL: TransactionSide.Sell,
};

const RULE_ERROR_COLUMN: Partial<Record<TransactionRuleError, string>> = {
	INVALID_SYMBOL: 'ativo',
	INVALID_QUANTITY: 'quantidade',
	INVALID_PRICE: 'preco',
	INVALID_FEES: 'taxas',
	INVALID_DATE: 'data',
	DATE_IN_FUTURE: 'data',
	DATE_TOO_OLD: 'data',
	INVALID_ASSET_CLASS: 'classe',
	INVALID_SIDE: 'lado',
	INVALID_LIQUIDITY_DAYS: 'liquidez_dias',
};

type Delimiter = ';' | ',';
interface RawRecord {
	line: number;
	cells: string[];
}

function normalizeHeader(cell: string): string {
	return cell
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim()
		.toLowerCase();
}

function detectDelimiter(text: string): Delimiter {
	const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
	const semicolons = firstLine.split(';').length - 1;
	const commas = firstLine.split(',').length - 1;
	return semicolons >= commas && semicolons > 0 ? ';' : ',';
}

/** Tokenizador RFC 4180 simples; cada registro leva a linha em que começa. */
function tokenize(text: string, delimiter: Delimiter): RawRecord[] {
	const records: RawRecord[] = [];
	let cells: string[] = [];
	let cell = '';
	let inQuotes = false;
	let line = 1;
	let recordLine = 1;

	const endRecord = () => {
		cells.push(cell);
		// Excel deixa `;;;;;;` em linhas apagadas: só delimitadores é linha em branco.
		const blank = cells.every((c) => c.trim() === '');
		if (!blank) records.push({ line: recordLine, cells });
		cells = [];
		cell = '';
	};

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') {
				inQuotes = false;
			} else {
				if (ch === '\n') line++;
				cell += ch;
			}
			continue;
		}
		if (ch === '"') {
			inQuotes = true;
		} else if (ch === delimiter) {
			cells.push(cell);
			cell = '';
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && text[i + 1] === '\n') i++;
			endRecord();
			line++;
			recordLine = line;
		} else {
			cell += ch;
		}
	}
	if (cell !== '' || cells.length > 0) endRecord();
	return records;
}

/** Aceita número no formato do delimitador; devolve dígitos e decimais. */
function splitNumber(
	raw: string,
	delimiter: Delimiter
): { int: string; frac: string } | null {
	const value = raw.trim();
	const pattern =
		delimiter === ';'
			? /^([1-9]\d{0,2}(?:\.\d{3})+|\d+)(?:,(\d+))?$/
			: /^(\d+)(?:\.(\d+))?$/;
	const match = pattern.exec(value);
	if (!match) return null;
	return { int: match[1].replace(/\./g, ''), frac: match[2] ?? '' };
}

function parseQuantity(raw: string, delimiter: Delimiter): number {
	const parts = splitNumber(raw, delimiter);
	if (!parts) return NaN;
	return Number(parts.frac ? `${parts.int}.${parts.frac}` : parts.int);
}

/** Reais com até 2 casas -> centavos inteiros, sem passar por float. */
function parseMoneyMinor(
	raw: string,
	delimiter: Delimiter,
	emptyValue: number
): number {
	if (raw.trim() === '') return emptyValue;
	const parts = splitNumber(raw, delimiter);
	if (!parts || parts.frac.length > 2) return NaN;
	const minor = Number(parts.int + parts.frac.padEnd(2, '0'));
	return Number.isSafeInteger(minor) ? minor : NaN;
}

function parseDate(raw: string): string {
	const value = raw.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
	const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
	return br ? `${br[3]}-${br[2]}-${br[1]}` : '';
}

function parseLiquidityDays(raw: string): number | undefined {
	const value = raw.trim();
	if (value === '') return undefined;
	return /^\d+$/.test(value) ? Number(value) : NaN;
}

function buildInput(
	get: (column: string) => string,
	hasLiquidity: boolean,
	delimiter: Delimiter
): TransactionInput {
	const input: TransactionInput = {
		symbol: normalizeSymbol(get('ativo')),
		assetClass: ASSET_CLASS_ALIASES[
			get('classe').trim().toUpperCase()
		] as AssetClass,
		side: SIDE_ALIASES[get('lado').trim().toUpperCase()] as TransactionSide,
		quantity: parseQuantity(get('quantidade'), delimiter),
		unitPriceMinor: parseMoneyMinor(get('preco'), delimiter, NaN),
		feesMinor: parseMoneyMinor(get('taxas'), delimiter, 0),
		currency: 'BRL',
		tradeDate: parseDate(get('data')),
	};
	if (hasLiquidity) {
		const days = parseLiquidityDays(get('liquidez_dias'));
		if (days !== undefined) input.liquidityDays = days;
	}
	return input;
}

export function parseAdvisorCsvDetailed(
	text: string,
	today: string
): CsvDetailedParseResult {
	const source = text.replace(/^\uFEFF/, '');
	const delimiter = detectDelimiter(source);
	const records = tokenize(source, delimiter);

	if (records.length <= 1) {
		return { ok: false, errors: [{ line: 1, code: 'EMPTY_FILE' }] };
	}

	const header = records[0].cells.map(normalizeHeader);
	const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
	if (missing.length > 0) {
		return {
			ok: false,
			errors: missing.map((column) => ({
				line: 1,
				code: 'MISSING_COLUMN' as const,
				column,
			})),
		};
	}

	const dataRecords = records.slice(1);
	if (dataRecords.length > CSV_MAX_ROWS) {
		return { ok: false, errors: [{ line: 1, code: 'TOO_MANY_ROWS' }] };
	}

	const index = new Map<string, number>();
	[...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].forEach((c) => {
		const at = header.indexOf(c);
		if (at >= 0) index.set(c, at);
	});

	const errors: CsvRowError[] = [];
	const rows: CsvParsedRow[] = [];
	for (const record of dataRecords) {
		if (record.cells.length !== header.length) {
			errors.push({ line: record.line, code: 'WRONG_COLUMN_COUNT' });
			continue;
		}
		const input = buildInput(
			(column) => record.cells[index.get(column) as number] ?? '',
			index.has('liquidez_dias'),
			delimiter
		);
		const ruleErrors = validateTransactionInput(input, today);
		for (const code of ruleErrors) {
			const column = RULE_ERROR_COLUMN[code];
			errors.push({
				line: record.line,
				code,
				...(column !== undefined && { column }),
			});
		}
		rows.push({ line: record.line, input });
	}

	if (errors.length > 0) {
		return { ok: false, errors: errors.slice(0, MAX_REPORTED_ERRORS) };
	}
	return { ok: true, rows };
}

export function parseAdvisorCsv(text: string, today: string): CsvParseResult {
	const result = parseAdvisorCsvDetailed(text, today);
	if ('errors' in result) return { ok: false, errors: result.errors };
	return { ok: true, rows: result.rows.map((r) => r.input) };
}
