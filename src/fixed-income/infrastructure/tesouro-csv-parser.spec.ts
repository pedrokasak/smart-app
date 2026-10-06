import {
	LatestTesouroAccumulator,
	TESOURO_CSV_HEADER,
	TesouroCsvFormatError,
	parseTesouroCsvLine,
} from './tesouro-csv-parser';

const lines = (...rows: string[]) => [TESOURO_CSV_HEADER, ...rows];

const feed = (rows: string[]) => {
	const accumulator = new LatestTesouroAccumulator();
	for (const row of rows) accumulator.pushLine(row);
	return accumulator.result();
};

describe('parseTesouroCsvLine', () => {
	it('lê um IPCA+ do CSV real (vírgula decimal, datas DD/MM/AAAA)', () => {
		expect(
			parseTesouroCsvLine(
				'Tesouro IPCA+;15/05/2035;02/10/2026;7,55;7,67;2549,88;2536,42;2536,42'
			)
		).toEqual({
			id: 'IPCA_PLUS:2035-05-15',
			family: 'IPCA_PLUS',
			name: 'Tesouro IPCA+ 2035',
			maturityDate: '2035-05-15',
			buyRatePct: 7.55,
			sellRatePct: 7.67,
			unitPrice: 2549.88,
			baseDate: '2026-10-02',
		});
	});

	it('lê Selic (spread) e Prefixado', () => {
		const selic = parseTesouroCsvLine(
			'Tesouro Selic;01/03/2031;02/10/2026;0,09;0,10;19943,12;19924,17;19924,17'
		);
		expect(selic).toMatchObject({
			family: 'SELIC',
			buyRatePct: 0.09,
			name: 'Tesouro Selic 2031',
		});
		const pre = parseTesouroCsvLine(
			'Tesouro Prefixado;01/01/2031;02/10/2026;14,07;14,19;574,80;572,10;572,10'
		);
		expect(pre).toMatchObject({ family: 'PREFIXED', buyRatePct: 14.07 });
	});

	it.each([
		'Tesouro IPCA+ com Juros Semestrais;15/08/2040;02/10/2026;7,31;7,43;4282,11;4260,00;4260,00',
		'Tesouro Prefixado com Juros Semestrais;01/01/2029;02/10/2026;13,62;13,74;962,78;960,00;960,00',
		'Tesouro Renda+ Aposentadoria Extra;15/12/2054;02/10/2026;7,16;7,28;1466,06;1460,00;1460,00',
		'Tesouro Educa+;15/12/2031;02/10/2026;7,42;7,54;3932,78;3920,00;3920,00',
		'Tesouro IGPM+ com Juros Semestrais;01/01/2031;02/10/2026;7,87;7,99;7837,56;7800,00;7800,00',
	])('ignora tipo fora do escopo: %s', (line) => {
		expect(parseTesouroCsvLine(line)).toBeNull();
	});

	it.each([
		'Tesouro Selic;01/03/2031;02/10/2026;;0,10;19943,12;19924,17;19924,17',
		'Tesouro Selic;31/02/2031;02/10/2026;0,09;0,10;19943,12;19924,17;19924,17',
		'Tesouro Selic;01/03/2031;02-10-2026;0,09;0,10;19943,12;19924,17;19924,17',
		'Tesouro Selic;01/03/2031;02/10/2026;abc;0,10;19943,12;19924,17;19924,17',
		'Tesouro Selic;01/03/2031',
		'',
	])('linha malformada vira null, nunca número inventado: %s', (line) => {
		expect(parseTesouroCsvLine(line)).toBeNull();
	});
});

describe('LatestTesouroAccumulator', () => {
	const old =
		'Tesouro Selic;01/03/2031;01/10/2026;0,08;0,09;19900,00;19890,00;19890,00';
	const latestSelic =
		'Tesouro Selic;01/03/2031;02/10/2026;0,09;0,10;19943,12;19924,17;19924,17';
	const latestPre =
		'Tesouro Prefixado;01/01/2031;02/10/2026;14,07;14,19;574,80;572,10;572,10';

	it('guarda só o pregão mais recente', () => {
		const result = feed(lines(latestSelic, latestPre, old));
		expect(result?.baseDate).toBe('2026-10-02');
		expect(result?.titles.map((title) => title.id).sort()).toEqual([
			'PREFIXED:2031-01-01',
			'SELIC:2031-03-01',
		]);
	});

	it('não depende da ordem do arquivo (pregão antigo antes do novo)', () => {
		const result = feed(lines(old, latestSelic, latestPre));
		expect(result?.baseDate).toBe('2026-10-02');
		expect(result?.titles).toHaveLength(2);
		expect(
			result?.titles.find((title) => title.family === 'SELIC')?.buyRatePct
		).toBe(0.09);
	});

	it('aceita fim de linha CRLF e BOM no cabeçalho', () => {
		const result = feed([`﻿${TESOURO_CSV_HEADER}\r`, `${latestSelic}\r`]);
		expect(result?.titles).toHaveLength(1);
	});

	it('pula linhas em branco e tipos ignorados sem perder o resto', () => {
		const result = feed(
			lines(
				'',
				'Tesouro Educa+;15/12/2031;02/10/2026;7,42;7,54;3932,78;3920,00;3920,00',
				latestSelic
			)
		);
		expect(result?.titles).toHaveLength(1);
	});

	it('devolve null quando nenhum título suportado aparece', () => {
		expect(
			feed(
				lines(
					'Tesouro Educa+;15/12/2031;02/10/2026;7,42;7,54;3932,78;3920,00;3920,00'
				)
			)
		).toBeNull();
	});

	it('cabeçalho diferente falha alto em vez de ler lixo', () => {
		const accumulator = new LatestTesouroAccumulator();
		expect(() => accumulator.pushLine('Titulo;Vencimento;Base;Taxa')).toThrow(
			TesouroCsvFormatError
		);
	});

	it('arquivo vazio falha alto', () => {
		expect(() => new LatestTesouroAccumulator().result()).toThrow(
			TesouroCsvFormatError
		);
	});
});
