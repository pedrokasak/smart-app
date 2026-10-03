import { parseFundosNetFilings } from 'src/ri-intelligence/watch/infrastructure/fundosnet-filing.parser';

/** Linhas da FundosNet para o HGLG11, como vieram em 03/10/2026 (resumidas). */
const ROWS = [
	{
		id: 1338095,
		descricaoFundo: 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO',
		categoriaDocumento: 'Fato Relevante',
		tipoDocumento: '',
		especieDocumento: '',
		dataEntrega: '01/10/2026 19:04',
		dataReferencia: '01/10/2026',
		arquivoEstruturado: ' ',
		status: 'AC',
	},
	{
		id: 1335997,
		descricaoFundo: 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO',
		categoriaDocumento: 'Aviso aos Cotistas - Estruturado',
		tipoDocumento: 'Rendimentos e Amortizações',
		especieDocumento: '',
		dataEntrega: '30/09/2026 17:39',
		dataReferencia: '30/09/2026',
		arquivoEstruturado: ' ',
		status: 'AC',
	},
	{
		id: 1326416,
		descricaoFundo: 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO',
		categoriaDocumento: 'Informes Periódicos',
		tipoDocumento: 'Informe Mensal Estruturado ',
		especieDocumento: '',
		dataEntrega: '23/09/2026 10:40',
		dataReferencia: '08/2026',
		arquivoEstruturado: ' ',
		status: 'AC',
	},
	{
		id: 1316897,
		descricaoFundo: 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO',
		categoriaDocumento: 'Relatórios',
		tipoDocumento: 'Relatório Gerencial',
		especieDocumento: '',
		dataEntrega: '11/09/2026 20:07',
		dataReferencia: '31/08/2026',
		arquivoEstruturado: ' ',
		status: 'IC',
	},
];

describe('parseFundosNetFilings (TRA-266)', () => {
	it('reads each document with its download link and dates', () => {
		const [fact] = parseFundosNetFilings(ROWS);

		expect(fact).toEqual({
			id: '1338095',
			fund: 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO',
			category: 'Fato Relevante',
			type: null,
			species: null,
			referenceDate: '2026-10-01',
			deliveredOn: '2026-10-01',
			downloadUrl:
				'https://fnet.bmfbovespa.com.br/fnet/publico/downloadDocumento?id=1338095',
			active: true,
			structured: false,
		});
	});

	// `arquivoEstruturado` vem " " ate nos XMLs: o nome e que diz.
	it('flags structured XML filings by their name', () => {
		const [, notice, monthly] = parseFundosNetFilings(ROWS);

		expect(notice.structured).toBe(true);
		expect(monthly.structured).toBe(true);
		expect(monthly.type).toBe('Informe Mensal Estruturado');
	});

	it('reads a month-only reference date', () => {
		expect(parseFundosNetFilings(ROWS)[2].referenceDate).toBe('2026-08-01');
	});

	it('marks a replaced version as inactive', () => {
		expect(parseFundosNetFilings(ROWS)[3].active).toBe(false);
	});

	it('drops rows without id, category or a readable delivery date', () => {
		expect(
			parseFundosNetFilings([
				{ ...ROWS[0], id: null },
				{ ...ROWS[0], id: 'abc' },
				{ ...ROWS[0], categoriaDocumento: '  ' },
				{ ...ROWS[0], dataEntrega: '2026-10-01' },
				null,
			])
		).toEqual([]);
	});

	it('returns nothing for a payload that is not a list', () => {
		expect(parseFundosNetFilings({ data: ROWS })).toEqual([]);
	});
});
