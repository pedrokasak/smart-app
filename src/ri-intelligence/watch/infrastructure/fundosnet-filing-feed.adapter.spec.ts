import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { FundosNetFilingFeedAdapter } from 'src/ri-intelligence/watch/infrastructure/fundosnet-filing-feed.adapter';

describe('FundosNetFilingFeedAdapter (TRA-266)', () => {
	let httpService: { get: jest.Mock };
	let adapter: FundosNetFilingFeedAdapter;

	beforeEach(() => {
		httpService = { get: jest.fn() };
		adapter = new FundosNetFilingFeedAdapter(
			httpService as unknown as HttpService
		);
	});

	it('asks the fund documents in the window, in Brasilia dates', async () => {
		httpService.get.mockReturnValue(of({ data: { data: [] } }));

		await adapter.listFundFilings(
			'11728688000147',
			// 02h UTC do dia 24 ainda e dia 23 em Brasilia.
			new Date('2026-09-24T02:00:00.000Z'),
			new Date('2026-10-03T15:00:00.000Z')
		);

		const [url, config] = httpService.get.mock.calls[0];
		expect(url).toBe(FundosNetFilingFeedAdapter.ENDPOINT);
		expect(config.params).toEqual(
			expect.objectContaining({
				cnpjFundo: '11728688000147',
				dataInicial: '23/09/2026',
				dataFinal: '03/10/2026',
				l: FundosNetFilingFeedAdapter.PAGE_SIZE,
				'o[0][dataEntrega]': 'desc',
			})
		);
		// Sem este cabecalho a FundosNet nao responde JSON.
		expect(config.headers['X-Requested-With']).toBe('XMLHttpRequest');
		expect(config.headers['User-Agent']).toMatch(/Trackerr/);
		expect(config.timeout).toBeGreaterThan(0);
	});

	it('parses the listed documents', async () => {
		httpService.get.mockReturnValue(
			of({
				data: {
					data: [
						{
							id: 1338095,
							descricaoFundo: 'PÁTRIA LOG',
							categoriaDocumento: 'Fato Relevante',
							dataEntrega: '01/10/2026 19:04',
							dataReferencia: '01/10/2026',
							status: 'AC',
						},
					],
				},
			})
		);

		const filings = await adapter.listFundFilings(
			'11728688000147',
			new Date('2026-09-23T12:00:00.000Z'),
			new Date('2026-10-03T12:00:00.000Z')
		);

		expect(filings.map((f) => f.id)).toEqual(['1338095']);
	});

	// Pagina de erro ou mudanca de formato: falha, e o vigia segue.
	it('fails on a response that is not the listing', async () => {
		httpService.get.mockReturnValue(of({ data: '<html>erro</html>' }));

		await expect(
			adapter.listFundFilings('11728688000147', new Date(), new Date())
		).rejects.toThrow('fundosnet_unexpected_response');
	});

	it('propagates a network failure', async () => {
		httpService.get.mockReturnValue(throwError(() => new Error('ECONNRESET')));

		await expect(
			adapter.listFundFilings('11728688000147', new Date(), new Date())
		).rejects.toThrow('ECONNRESET');
	});
});
