import {
	INFORME_DIARIO_HEADER,
	InformeDiarioSchemaError,
	LatestFundQuoteAccumulator,
} from './informe-diario.parser';

const HEADER = INFORME_DIARIO_HEADER.join(';');

// Linhas no formato do arquivo real de 09/2026 (CRLF, máscara no CNPJ).
const rows = [
	'CLASSES - FIF;00.017.024/0001-53;;2026-09-01;1107741.39;44.636723400000;1214792.63;0.00;0.00;1\r',
	'CLASSES - FIF;00.017.024/0001-53;;2026-09-02;1108302.04;44.655755500000;1215310.59;0.00;0.00;1\r',
	'CLASSES - FIF;09.613.232/0001-90;;2026-09-02;-17140918.05;-0.970952080000;-17504551.68;0.00;0.00;7\r',
];

function parse(lines: string[]) {
	const accumulator = new LatestFundQuoteAccumulator();
	for (const line of lines) accumulator.pushLine(line);
	return accumulator.result();
}

describe('LatestFundQuoteAccumulator', () => {
	it('keeps only the latest quote of each class', () => {
		const result = parse([`${HEADER}\r`, ...rows]);

		expect(result.rows).toBe(3);
		expect(result.invalidRows).toBe(0);
		expect(result.latestDate).toBe('2026-09-02');
		expect(result.quotes).toEqual([
			{
				cnpj: '00017024000153',
				subclassId: null,
				date: '2026-09-02',
				quota: 44.6557555,
				netAssetValue: 1215310.59,
				investorCount: 1,
			},
			{
				cnpj: '09613232000190',
				subclassId: null,
				date: '2026-09-02',
				quota: -0.97095208,
				netAssetValue: -17504551.68,
				investorCount: 7,
			},
		]);
	});

	it('never replaces a quote with an older one, whatever the file order', () => {
		const result = parse([HEADER, rows[1], rows[0]]);

		expect(result.quotes[0].date).toBe('2026-09-02');
		expect(result.quotes[0].quota).toBe(44.6557555);
	});

	it('keeps class and subclass quotes apart', () => {
		const result = parse([
			HEADER,
			rows[0],
			'CLASSES - FIF;00.017.024/0001-53;MZMRC1747322915;2026-09-01;10;1.5;10;0;0;3',
		]);

		expect(result.quotes.map((q) => [q.cnpj, q.subclassId, q.quota])).toEqual([
			['00017024000153', null, 44.6367234],
			['00017024000153', 'MZMRC1747322915', 1.5],
		]);
	});

	it('counts and skips malformed rows', () => {
		const result = parse([
			HEADER,
			rows[0],
			'CLASSES - FIF;00.017.024/0001-54;;2026-09-01;1;1;1;0;0;1', // dígito errado
			'CLASSES - FIF;00.017.024/0001-53;;01/09/2026;1;1;1;0;0;1', // data
			'CLASSES - FIF;00.017.024/0001-53;;2026-09-03;1;abc;1;0;0;1', // cota
			'CLASSES - FIF;00.017.024/0001-53;;2026-09-03;1;1', // colunas
			'',
		]);

		expect(result.rows).toBe(5);
		expect(result.invalidRows).toBe(4);
		expect(result.quotes).toHaveLength(1);
		expect(result.quotes[0].date).toBe('2026-09-01');
	});

	it('tolerates a missing investor count', () => {
		const result = parse([
			HEADER,
			'CLASSES - FIF;00.017.024/0001-53;;2026-09-01;1;2;1;0;0;',
		]);

		expect(result.quotes[0].investorCount).toBeNull();
	});

	it('stops when the header changes', () => {
		const accumulator = new LatestFundQuoteAccumulator();

		expect(() =>
			accumulator.pushLine(HEADER.replace('VL_QUOTA', 'VL_COTA'))
		).toThrow(InformeDiarioSchemaError);
	});

	it('refuses an empty file', () => {
		expect(() => new LatestFundQuoteAccumulator().result()).toThrow(
			InformeDiarioSchemaError
		);
	});

	it('accepts a BOM before the header', () => {
		expect(parse([`﻿${HEADER}`, rows[0]]).quotes).toHaveLength(1);
	});
});
