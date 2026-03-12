import { Trade } from 'src/fiscal/domain/trade';

type Row = Record<string, string>;

const normalizeKey = (k: string) =>
	k
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');

const parseNumber = (v: string) => {
	const s = (v ?? '').toString().trim().replace(/\./g, '').replace(',', '.');
	const n = Number(s);
	return Number.isFinite(n) ? n : NaN;
};

const parseDate = (v: string) => {
	const raw = (v ?? '').toString().trim();
	// Accept: YYYY-MM-DD, DD/MM/YYYY
	if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return new Date(raw);
	if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) {
		const [dd, mm, yyyy] = raw.split('/');
		return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
	}
	const d = new Date(raw);
	return d;
};

const mapSide = (v: string): 'buy' | 'sell' => {
	const s = (v ?? '').toString().trim().toLowerCase();
	if (['buy', 'compra', 'c', 'b'].includes(s)) return 'buy';
	if (['sell', 'venda', 'v', 's'].includes(s)) return 'sell';
	// default assume buy
	return 'buy';
};

function splitLine(line: string, delimiter: string): string[] {
	// Minimal CSV split with quotes support
	const out: string[] = [];
	let cur = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			inQuotes = !inQuotes;
			continue;
		}
		if (!inQuotes && ch === delimiter) {
			out.push(cur);
			cur = '';
			continue;
		}
		cur += ch;
	}
	out.push(cur);
	return out.map((x) => x.trim());
}

function detectDelimiter(headerLine: string): string {
	const comma = (headerLine.match(/,/g) || []).length;
	const semi = (headerLine.match(/;/g) || []).length;
	return semi > comma ? ';' : ',';
}

export function parseTradesFromCsv(csvText: string): Trade[] {
	const lines = csvText
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	if (lines.length < 2) return [];

	const delimiter = detectDelimiter(lines[0]);
	const headers = splitLine(lines[0], delimiter).map(normalizeKey);

	const rows: Row[] = lines.slice(1).map((line) => {
		const cols = splitLine(line, delimiter);
		const row: Row = {};
		headers.forEach((h, idx) => {
			row[h] = (cols[idx] ?? '').toString().trim();
		});
		return row;
	});

	const get = (r: Row, keys: string[]) => {
		for (const k of keys) {
			const nk = normalizeKey(k);
			if (r[nk] != null && r[nk] !== '') return r[nk];
		}
		return '';
	};

	return rows
		.map((r) => {
			const date = parseDate(
				get(r, ['date', 'data', 'dt', 'data_operacao', 'dataoperacao'])
			);
			const symbol = get(r, ['symbol', 'ativo', 'ticker', 'codigo']).toUpperCase();
			const side = mapSide(get(r, ['side', 'operacao', 'tipo', 'compra_venda']));
			const quantity = parseNumber(get(r, ['quantity', 'quantidade', 'qtd']));
			const price = parseNumber(get(r, ['price', 'preco', 'preco_unitario', 'valor_unitario']));
			const feesRaw = get(r, ['fees', 'taxas', 'corretagem', 'emolumentos']);
			const fees = feesRaw ? parseNumber(feesRaw) : 0;

			if (!symbol) return null;
			if (!Number.isFinite(quantity) || quantity <= 0) return null;
			if (!Number.isFinite(price) || price < 0) return null;
			if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

			return {
				assetSymbol: symbol,
				side,
				quantity,
				price,
				fees: Number.isFinite(fees) ? fees : 0,
				date,
			} satisfies Trade;
		})
		.filter(Boolean) as Trade[];
}

