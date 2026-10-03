import { InMemoryRiWatchStore } from 'src/ri-intelligence/watch/application/in-memory-ri-watch-store.fixture';
import { FiiFilingFeedPort } from 'src/ri-intelligence/watch/application/ports/fii-filing-feed.port';
import { FiiFundDirectory } from 'src/ri-intelligence/watch/application/ports/fii-fund-directory.port';
import { HeldTickerDirectory } from 'src/ri-intelligence/watch/application/ports/held-ticker-directory.port';
import { RiWatchFiiScanner } from 'src/ri-intelligence/watch/application/ri-watch-fii.scanner';
import {
	RI_WATCH_DEFAULTS,
	RiWatchConfig,
} from 'src/ri-intelligence/watch/application/ri-watch.config';
import { FiiFiling } from 'src/ri-intelligence/watch/domain/fii-filing';

const NOW = new Date('2026-10-03T15:00:00.000Z');
const HGLG_CNPJ = '11728688000147';
const KNRI_CNPJ = '12005956000165';

function filing(id: string, over: Partial<FiiFiling> = {}): FiiFiling {
	return {
		id,
		fund: 'PÁTRIA LOG - FUNDO DE INVESTIMENTO IMOBILIÁRIO',
		category: 'Fato Relevante',
		type: null,
		species: null,
		referenceDate: '2026-10-01',
		deliveredOn: '2026-10-01',
		downloadUrl: `https://fnet.bmfbovespa.com.br/fnet/publico/downloadDocumento?id=${id}`,
		active: true,
		structured: false,
		...over,
	};
}

describe('RiWatchFiiScanner (TRA-266)', () => {
	let store: InMemoryRiWatchStore;
	let directory: jest.Mocked<HeldTickerDirectory>;
	let funds: jest.Mocked<FiiFundDirectory>;
	let feed: jest.Mocked<FiiFilingFeedPort>;
	let config: RiWatchConfig;

	const makeScanner = () =>
		new RiWatchFiiScanner(store, directory, funds, feed, config);

	beforeEach(() => {
		store = new InMemoryRiWatchStore();
		directory = {
			heldStockTickers: jest.fn().mockResolvedValue(['PETR4']),
			heldFiiTickers: jest.fn().mockResolvedValue(['HGLG11']),
		};
		funds = {
			resolveFundCnpj: jest.fn(async (ticker: string) =>
				ticker.startsWith('HGLG')
					? HGLG_CNPJ
					: ticker.startsWith('KNRI')
						? KNRI_CNPJ
						: null
			),
		};
		feed = {
			listFundFilings: jest.fn().mockResolvedValue([filing('1338095')]),
		};
		config = { ...RI_WATCH_DEFAULTS, enabled: true, fiiEnabled: true };
	});

	it('does nothing while switched off', async () => {
		config.fiiEnabled = false;

		const result = await makeScanner().scan(NOW);

		expect(result.status).toBe('disabled');
		expect(directory.heldFiiTickers).not.toHaveBeenCalled();
		expect(feed.listFundFilings).not.toHaveBeenCalled();
	});

	it('skips the round without FIIs in any portfolio', async () => {
		directory.heldFiiTickers.mockResolvedValue([]);

		const result = await makeScanner().scan(NOW);

		expect(result.status).toBe('skipped');
		expect(funds.resolveFundCnpj).not.toHaveBeenCalled();
	});

	it('registers the new filings of a held FII under its ticker', async () => {
		const result = await makeScanner().scan(NOW);

		expect(result).toEqual({
			status: 'ok',
			tickers: 1,
			unresolved: 0,
			failedFunds: 0,
			registered: 1,
		});
		const [doc] = [...store.docs.values()];
		expect(doc.ticker).toBe('HGLG11');
		expect(doc.record.cvmCategory).toBe('Fato Relevante');
		expect(doc.status).toBe('pending');
	});

	it('asks the fund by CNPJ over the discovery window', async () => {
		await makeScanner().scan(NOW);

		const [cnpj, from, to] = feed.listFundFilings.mock.calls[0];
		expect(cnpj).toBe(HGLG_CNPJ);
		expect(NOW.getTime() - from.getTime()).toBe(
			config.lookbackDays * 24 * 60 * 60 * 1000
		);
		expect(to).toBe(NOW);
	});

	it('leaves out replaced versions, structured XML and routine filings', async () => {
		feed.listFundFilings.mockResolvedValue([
			filing('1', { active: false }),
			filing('2', {
				category: 'Aviso aos Cotistas - Estruturado',
				type: 'Rendimentos e Amortizações',
				structured: true,
			}),
			filing('3', { category: 'Regulamento' }),
			filing('4', { category: 'Relatórios', type: 'Relatório Gerencial' }),
		]);

		const result = await makeScanner().scan(NOW);

		expect(result.registered).toBe(1);
		expect([...store.docs.values()][0].record.cvmType).toBe(
			'Relatório Gerencial'
		);
	});

	it('never registers the same filing twice across rounds', async () => {
		const scanner = makeScanner();

		await scanner.scan(NOW);
		const second = await scanner.scan(NOW);

		expect(second.registered).toBe(0);
		expect(store.docs.size).toBe(1);
	});

	// Cota e recibo do mesmo fundo: uma consulta, sempre sob o mesmo ticker.
	it('asks each fund once, under the first ticker in order', async () => {
		directory.heldFiiTickers.mockResolvedValue(['HGLG13', 'HGLG11']);

		await makeScanner().scan(NOW);

		expect(feed.listFundFilings).toHaveBeenCalledTimes(1);
		expect([...store.docs.values()][0].ticker).toBe('HGLG11');
	});

	it('counts FIIs without a known CNPJ and goes on with the others', async () => {
		directory.heldFiiTickers.mockResolvedValue(['HGLG11', 'XPTO11']);

		const result = await makeScanner().scan(NOW);

		expect(result.unresolved).toBe(1);
		expect(result.registered).toBe(1);
	});

	it('keeps going when the FundosNet fails for one fund', async () => {
		directory.heldFiiTickers.mockResolvedValue(['HGLG11', 'KNRI11']);
		feed.listFundFilings
			.mockRejectedValueOnce(new Error('fundosnet_unexpected_response'))
			.mockResolvedValueOnce([filing('9', { fund: 'KINEA RENDA' })]);

		const result = await makeScanner().scan(NOW);

		expect(result).toEqual(
			expect.objectContaining({ status: 'ok', failedFunds: 1, registered: 1 })
		);
	});

	// FundosNet travada: a rodada nao pode esperar 30s por cada fundo.
	it('stops asking after three failures in a row', async () => {
		directory.heldFiiTickers.mockResolvedValue([
			'AAAA11',
			'BBBB11',
			'CCCC11',
			'DDDD11',
			'EEEE11',
		]);
		funds.resolveFundCnpj.mockImplementation(async (ticker: string) =>
			ticker.slice(0, 4).padEnd(14, '0')
		);
		feed.listFundFilings.mockRejectedValue(new Error('timeout'));

		const result = await makeScanner().scan(NOW);

		expect(feed.listFundFilings).toHaveBeenCalledTimes(3);
		expect(result).toEqual(
			expect.objectContaining({ status: 'failed', failedFunds: 3 })
		);
	});

	it('resets the failure count after a fund answers', async () => {
		directory.heldFiiTickers.mockResolvedValue([
			'AAAA11',
			'BBBB11',
			'CCCC11',
			'DDDD11',
			'EEEE11',
		]);
		funds.resolveFundCnpj.mockImplementation(async (ticker: string) =>
			ticker.slice(0, 4).padEnd(14, '0')
		);
		feed.listFundFilings
			.mockRejectedValueOnce(new Error('timeout'))
			.mockRejectedValueOnce(new Error('timeout'))
			.mockResolvedValueOnce([])
			.mockRejectedValueOnce(new Error('timeout'))
			.mockRejectedValueOnce(new Error('timeout'));

		const result = await makeScanner().scan(NOW);

		expect(feed.listFundFilings).toHaveBeenCalledTimes(5);
		expect(result.status).toBe('ok');
	});

	// Cadastro da CVM fora: os FIIs saem desta rodada, sem lancar.
	it('reports a failed round when the fund registry is down', async () => {
		funds.resolveFundCnpj.mockRejectedValue(
			new Error('cvm_fii_registry_unavailable')
		);

		const result = await makeScanner().scan(NOW);

		expect(result.status).toBe('failed');
		expect(feed.listFundFilings).not.toHaveBeenCalled();
	});
});
