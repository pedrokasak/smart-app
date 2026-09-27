import { jest } from '@jest/globals';
import axios from 'axios';
import {
	fetchSgsDailySeries,
	mergeSeries,
	SgsWindowFetchError,
	splitIntoWindows,
	toBacenDate,
} from './bcb-sgs-series';

jest.mock('axios');

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('splitIntoWindows', () => {
	it('returns a single window when the range fits in three years', () => {
		const windows = splitIntoWindows(utc('2024-01-01'), utc('2024-06-30'));

		expect(
			windows.map((w) => [toBacenDate(w.from), toBacenDate(w.to)])
		).toEqual([['01/01/2024', '30/06/2024']]);
	});

	it('splits fifteen years into contiguous non-overlapping windows of at most three years', () => {
		const windows = splitIntoWindows(utc('2011-01-01'), utc('2025-12-31'));

		expect(
			windows.map((w) => [toBacenDate(w.from), toBacenDate(w.to)])
		).toEqual([
			['01/01/2011', '31/12/2013'],
			['01/01/2014', '31/12/2016'],
			['01/01/2017', '31/12/2019'],
			['01/01/2020', '31/12/2022'],
			['01/01/2023', '31/12/2025'],
		]);
	});

	it('never produces a window longer than three years', () => {
		const windows = splitIntoWindows(utc('1995-03-17'), utc('2026-09-26'));

		for (const window of windows) {
			const limit = new Date(window.from.getTime());
			limit.setUTCFullYear(limit.getUTCFullYear() + 3);
			expect(window.to.getTime()).toBeLessThan(limit.getTime());
		}
		expect(toBacenDate(windows[0].from)).toBe('17/03/1995');
		expect(toBacenDate(windows[windows.length - 1].to)).toBe('26/09/2026');
	});

	it('ignores the time of day and handles a single-day range', () => {
		const windows = splitIntoWindows(
			new Date('2026-07-01T15:30:00.000Z'),
			new Date('2026-07-01T23:59:00.000Z')
		);

		expect(windows).toHaveLength(1);
		expect(toBacenDate(windows[0].from)).toBe('01/07/2026');
		expect(toBacenDate(windows[0].to)).toBe('01/07/2026');
	});

	it('returns no window when from is after to', () => {
		expect(splitIntoWindows(utc('2026-07-02'), utc('2026-07-01'))).toEqual([]);
	});
});

describe('mergeSeries', () => {
	it('sorts by date and keeps a single point per day at the seams', () => {
		const merged = mergeSeries([
			[
				{ date: '2020-01-02', value: 2 },
				{ date: '2020-01-03', value: 3 },
			],
			[
				{ date: '2020-01-03', value: 99 },
				{ date: '2020-01-01', value: 1 },
			],
		]);

		expect(merged).toEqual([
			{ date: '2020-01-01', value: 1 },
			{ date: '2020-01-02', value: 2 },
			{ date: '2020-01-03', value: 3 },
		]);
	});
});

describe('fetchSgsDailySeries', () => {
	// Tipagem solta: o genérico de axios.get não aceita implementações que
	// devolvem só `{ data }`, que é tudo o que o código lê.
	const mockAxiosGet = axios.get as unknown as jest.Mock<
		(url: string, config?: unknown) => Promise<{ data: unknown }>
	>;

	afterEach(() => {
		mockAxiosGet.mockReset();
	});

	function dataInicialOf(url: string): string {
		return /dataInicial=([^&]+)/.exec(url)?.[1] ?? '';
	}

	it('fetches every window and returns the merged series in date order', async () => {
		mockAxiosGet.mockImplementation(async (url: string) => {
			const start = dataInicialOf(url);
			return { data: [{ data: start, valor: '0.05' }] };
		});

		const series = await fetchSgsDailySeries(
			12,
			utc('2011-01-01'),
			utc('2025-12-31')
		);

		expect(mockAxiosGet).toHaveBeenCalledTimes(5);
		expect(series.map((p) => p.date)).toEqual([
			'2011-01-01',
			'2014-01-01',
			'2017-01-01',
			'2020-01-01',
			'2023-01-01',
		]);
	});

	it('uses the series code and a per-window timeout', async () => {
		mockAxiosGet.mockResolvedValue({ data: [] });

		await fetchSgsDailySeries(433, utc('2026-01-01'), utc('2026-02-01'));

		expect(mockAxiosGet).toHaveBeenCalledWith(
			expect.stringContaining('bcdata.sgs.433/dados?formato=json'),
			{ timeout: 30_000 }
		);
	});

	it('limits concurrent requests to the BACEN', async () => {
		let inFlight = 0;
		let peak = 0;
		mockAxiosGet.mockImplementation(async () => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight--;
			return { data: [] };
		});

		await fetchSgsDailySeries(12, utc('1990-01-01'), utc('2025-12-31'), {
			concurrency: 3,
		});

		expect(mockAxiosGet).toHaveBeenCalledTimes(12);
		expect(peak).toBeLessThanOrEqual(3);
	});

	it('fails with the window that broke instead of returning a partial series', async () => {
		mockAxiosGet.mockImplementation(async (url: string) => {
			if (dataInicialOf(url) === '01/01/2014') throw new Error('HTTP 406');
			return { data: [{ data: dataInicialOf(url), valor: '0.05' }] };
		});

		const promise = fetchSgsDailySeries(
			12,
			utc('2011-01-01'),
			utc('2019-12-31')
		);

		await expect(promise).rejects.toBeInstanceOf(SgsWindowFetchError);
		await expect(promise).rejects.toThrow(
			'SGS 12 falhou na janela 01/01/2014–31/12/2016: HTTP 406'
		);
	});

	it('treats the SGS "value not found" body as an empty window', async () => {
		mockAxiosGet.mockImplementation(async (url: string) => {
			if (dataInicialOf(url) === '01/01/2014') {
				return {
					data: { erro: { statusCode: 404, detail: 'Value(s) not found' } },
				};
			}
			return { data: [{ data: dataInicialOf(url), valor: '0.05' }] };
		});

		const series = await fetchSgsDailySeries(
			12,
			utc('2011-01-01'),
			utc('2016-12-31')
		);

		expect(series.map((p) => p.date)).toEqual(['2011-01-01']);
	});

	it('treats an HTTP 404 as an empty window', async () => {
		mockAxiosGet.mockRejectedValue({ response: { status: 404 } });

		const series = await fetchSgsDailySeries(
			12,
			utc('2026-01-03'),
			utc('2026-01-04')
		);

		expect(series).toEqual([]);
	});

	it('fails on any other non-list body instead of returning a partial series', async () => {
		mockAxiosGet.mockResolvedValue({
			data: { erro: { statusCode: 406, detail: 'Not Acceptable' } },
		});

		await expect(
			fetchSgsDailySeries(12, utc('2026-01-01'), utc('2026-02-01'))
		).rejects.toThrow('resposta inesperada do SGS (406)');
	});

	it('does not request windows before the series start', async () => {
		mockAxiosGet.mockResolvedValue({ data: [] });

		await fetchSgsDailySeries(12, utc('0001-01-01'), utc('1990-12-31'), {
			seriesStart: utc('1986-03-06'),
		});

		expect(mockAxiosGet).toHaveBeenCalledTimes(2);
		expect(mockAxiosGet).toHaveBeenCalledWith(
			expect.stringContaining('dataInicial=06/03/1986'),
			expect.anything()
		);
	});

	it('does not call the BACEN for an empty range', async () => {
		const series = await fetchSgsDailySeries(
			12,
			utc('2026-07-02'),
			utc('2026-07-01')
		);

		expect(series).toEqual([]);
		expect(mockAxiosGet).not.toHaveBeenCalled();
	});
});
