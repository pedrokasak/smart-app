import { AssetClass, TransactionSide } from '../../domain/enums';
import { CSV_MAX_ROWS, parseAdvisorCsv } from './advisor-csv.parser';

const today = '2025-06-10';
const HEADER = 'data;ativo;classe;lado;quantidade;preco;taxas';

describe('parseAdvisorCsv', () => {
	it('accepts a Brazilian file: BOM, semicolon, decimal comma, DD/MM/YYYY', () => {
		const csv =
			'\uFEFFData;Ativo;Classe;Lado;Quantidade;Preço;Taxas\n02/01/2025;petr4;ACAO;C;100;1.234,56;4,90\n';
		expect(parseAdvisorCsv(csv, today)).toEqual({
			ok: true,
			rows: [
				{
					symbol: 'PETR4',
					assetClass: AssetClass.Stock,
					side: TransactionSide.Buy,
					quantity: 100,
					unitPriceMinor: 123456,
					feesMinor: 490,
					currency: 'BRL',
					tradeDate: '2025-01-02',
				},
			],
		});
	});

	it('accepts comma delimiter with decimal point and ISO date', () => {
		const csv =
			'data,ativo,classe,lado,quantidade,preco,taxas\n2025-01-02,BTC,CRIPTO,BUY,0.5,350000.00,\n';
		expect(parseAdvisorCsv(csv, today)).toEqual({
			ok: true,
			rows: [
				{
					symbol: 'BTC',
					assetClass: AssetClass.Crypto,
					side: TransactionSide.Buy,
					quantity: 0.5,
					unitPriceMinor: 35000000,
					feesMinor: 0,
					currency: 'BRL',
					tradeDate: '2025-01-02',
				},
			],
		});
	});

	it('accepts any column order, an unknown column and optional liquidez_dias', () => {
		const csv =
			'lado;extra;ativo;data;classe;taxas;preco;quantidade;liquidez_dias\nvenda;x;HGLG11;03/02/2025;FII;0;10,00;5;2\n';
		const result = parseAdvisorCsv(csv, today);
		expect(result).toMatchObject({
			ok: true,
			rows: [
				{
					symbol: 'HGLG11',
					side: TransactionSide.Sell,
					assetClass: AssetClass.Fii,
					liquidityDays: 2,
					unitPriceMinor: 1000,
				},
			],
		});
	});

	it('rejects the whole file and lists every bad line', () => {
		const csv = [
			HEADER,
			'02/01/2025;PETR4;ACAO;C;100;10,00;0',
			'02/01/2025;PETR4;ACAO;X;100;10,00;0',
			'31/02/2025;PETR4;ACAO;C;100;10,00;0',
			'',
		].join('\n');
		expect(parseAdvisorCsv(csv, today)).toEqual({
			ok: false,
			errors: [
				{ line: 3, code: 'INVALID_SIDE', column: 'lado' },
				{ line: 4, code: 'INVALID_DATE', column: 'data' },
			],
		});
	});

	it('never assumes a purchase for an empty side', () => {
		const csv = `${HEADER}\n02/01/2025;PETR4;ACAO;;1;10,00;0\n`;
		expect(parseAdvisorCsv(csv, today)).toEqual({
			ok: false,
			errors: [{ line: 2, code: 'INVALID_SIDE', column: 'lado' }],
		});
	});

	it('treats a price with 3 decimals as an error, not rounding', () => {
		const csv = `${HEADER}\n02/01/2025;PETR4;ACAO;C;1;10,005;0\n`;
		expect(parseAdvisorCsv(csv, today)).toEqual({
			ok: false,
			errors: [{ line: 2, code: 'INVALID_PRICE', column: 'preco' }],
		});
	});

	it('reports a missing required column', () => {
		const csv =
			'data;ativo;classe;lado;quantidade;taxas\n02/01/2025;A;ACAO;C;1;0\n';
		expect(parseAdvisorCsv(csv, today)).toEqual({
			ok: false,
			errors: [{ line: 1, code: 'MISSING_COLUMN', column: 'preco' }],
		});
	});

	it('empty file or header only is EMPTY_FILE', () => {
		for (const csv of ['', '\n\n', `${HEADER}\n`, `${HEADER}\n\n`]) {
			expect(parseAdvisorCsv(csv, today)).toEqual({
				ok: false,
				errors: [{ line: 1, code: 'EMPTY_FILE' }],
			});
		}
	});

	it('more than the row limit is TOO_MANY_ROWS', () => {
		const row = '02/01/2025;PETR4;ACAO;C;1;10,00;0';
		const csv = [HEADER, ...Array(CSV_MAX_ROWS + 1).fill(row)].join('\n');
		expect(parseAdvisorCsv(csv, today)).toEqual({
			ok: false,
			errors: [{ line: 1, code: 'TOO_MANY_ROWS' }],
		});
		const ok = [HEADER, ...Array(CSV_MAX_ROWS).fill(row)].join('\n');
		expect(parseAdvisorCsv(ok, today).ok).toBe(true);
	});

	it('a row with a different column count is WRONG_COLUMN_COUNT', () => {
		const csv = `${HEADER}\n02/01/2025;PETR4;ACAO;C;1;10,00\n`;
		expect(parseAdvisorCsv(csv, today)).toEqual({
			ok: false,
			errors: [{ line: 2, code: 'WRONG_COLUMN_COUNT' }],
		});
	});

	it('reads a quoted cell containing the delimiter as one cell', () => {
		const csv = `${HEADER}\n02/01/2025;"PE;TR""4";ACAO;C;1;10,00;0\n`;
		expect(parseAdvisorCsv(csv, today)).toEqual({
			ok: false,
			errors: [{ line: 2, code: 'INVALID_SYMBOL', column: 'ativo' }],
		});
	});

	it('never evaluates a formula cell: it fails symbol validation', () => {
		const csv = `${HEADER}\n02/01/2025;=CMD();ACAO;C;1;10,00;0\n`;
		expect(parseAdvisorCsv(csv, today)).toEqual({
			ok: false,
			errors: [{ line: 2, code: 'INVALID_SYMBOL', column: 'ativo' }],
		});
	});

	it('parses money without floating point drift', () => {
		const csv = `${HEADER}\n02/01/2025;PETR4;ACAO;C;1;1.000.000,29;0,07\n`;
		expect(parseAdvisorCsv(csv, today)).toMatchObject({
			ok: true,
			rows: [{ unitPriceMinor: 100000029, feesMinor: 7 }],
		});
	});

	it.each(['0.125', '0.500', '00.123'])(
		'quantity %s in a semicolon file is INVALID_QUANTITY, not thousands',
		(quantity) => {
			const csv = `${HEADER}\n01/10/2024;BTC;CRIPTO;C;${quantity};1.500;0\n`;
			expect(parseAdvisorCsv(csv, today)).toEqual({
				ok: false,
				errors: [{ line: 2, code: 'INVALID_QUANTITY', column: 'quantidade' }],
			});
		}
	);

	it('price 0.500 in a semicolon file is INVALID_PRICE', () => {
		const csv = `${HEADER}\n01/10/2024;BTC;CRIPTO;C;1;0.500;0\n`;
		expect(parseAdvisorCsv(csv, today)).toEqual({
			ok: false,
			errors: [{ line: 2, code: 'INVALID_PRICE', column: 'preco' }],
		});
	});

	it.each([
		['1.234', 1234],
		['0,125', 0.125],
	])('quantity %s in a semicolon file is %d', (raw, quantity) => {
		const csv = `${HEADER}\n01/10/2024;BTC;CRIPTO;C;${raw};1.500;0\n`;
		expect(parseAdvisorCsv(csv, today)).toMatchObject({
			ok: true,
			rows: [{ quantity, unitPriceMinor: 150000 }],
		});
	});

	it('a delimiter-only row (cleared in Excel) is a blank line', () => {
		const csv = [
			HEADER,
			'02/01/2025;PETR4;ACAO;C;1;10,00;0',
			';;;;;;',
			'',
		].join('\n');
		expect(parseAdvisorCsv(csv, today)).toMatchObject({
			ok: true,
			rows: [{ symbol: 'PETR4' }],
		});
		expect(parseAdvisorCsv(`${HEADER}\n;;;;;;;\n`, today)).toEqual({
			ok: false,
			errors: [{ line: 1, code: 'EMPTY_FILE' }],
		});
	});

	it('caps the reported errors at 100', () => {
		const csv = [HEADER, ...Array(150).fill('02/01/2025;P;ACAO;X;1;10,00;0')];
		const result = parseAdvisorCsv(csv.join('\n'), today);
		expect(result.ok === false && result.errors).toHaveLength(100);
	});
});
