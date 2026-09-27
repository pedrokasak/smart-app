import { jest } from '@jest/globals';
import type {
	MacroSeriesPoint,
	MacroSeriesRepository,
	MacroSeriesSource,
} from './macro-series.ports';
import { MacroSeriesService, todayInSaoPaulo } from './macro-series.service';

class InMemoryRepository implements MacroSeriesRepository {
	readonly rows = new Map<string, { value: number; fetchedAt: Date }>();

	async findRange(code: number, from: string, to: string) {
		return [...this.rows.entries()]
			.map(([key, row]) => ({ key, ...row }))
			.filter(({ key }) => key.startsWith(`${code}|`))
			.map(({ key, value }) => ({ date: key.split('|')[1], value }))
			.filter((point) => point.date >= from && point.date <= to)
			.sort((a, b) => a.date.localeCompare(b.date));
	}

	async lastPoint(code: number) {
		const dates = [...this.rows.keys()]
			.filter((key) => key.startsWith(`${code}|`))
			.sort();
		const last = dates[dates.length - 1];
		if (!last) return null;
		return {
			date: last.split('|')[1],
			fetchedAt: this.rows.get(last)!.fetchedAt,
		};
	}

	async upsertMany(code: number, points: MacroSeriesPoint[], fetchedAt: Date) {
		for (const point of points) {
			this.rows.set(`${code}|${point.date}`, { value: point.value, fetchedAt });
		}
		return points.length;
	}
}

describe('MacroSeriesService', () => {
	const now = new Date('2026-09-26T15:00:00.000Z');
	let repository: InMemoryRepository;
	let fetchMock: jest.Mock<MacroSeriesSource['fetch']>;
	let service: MacroSeriesService;

	beforeEach(() => {
		repository = new InMemoryRepository();
		fetchMock = jest.fn<MacroSeriesSource['fetch']>();
		service = new MacroSeriesService(
			repository,
			{ fetch: fetchMock },
			() => now
		);
	});

	it('backfills from the catalog start on the first sync', async () => {
		fetchMock.mockResolvedValue([{ date: '2000-01-03', value: 0.07 }]);

		await service.sync('CDI');

		expect(fetchMock).toHaveBeenCalledWith(
			expect.objectContaining({ code: 12 }),
			'2000-01-01',
			'2026-09-26'
		);
	});

	it('re-reads a 45-day lookback window after the last stored point', async () => {
		await repository.upsertMany(12, [{ date: '2026-09-25', value: 0.05 }], now);
		fetchMock.mockResolvedValue([]);

		await service.sync('CDI');

		expect(fetchMock).toHaveBeenCalledWith(
			expect.anything(),
			'2026-08-12',
			'2026-09-26'
		);
	});

	it('resumes from the last stored point when the job was down longer than the lookback', async () => {
		await repository.upsertMany(12, [{ date: '2026-03-02', value: 0.05 }], now);
		fetchMock.mockResolvedValue([]);

		await service.sync('CDI');

		expect(fetchMock).toHaveBeenCalledWith(
			expect.anything(),
			'2026-03-02',
			'2026-09-26'
		);
	});

	it('serves reads from the repository without calling the source once loaded', async () => {
		await repository.upsertMany(
			433,
			[
				{ date: '2026-06-01', value: 0.16 },
				{ date: '2026-07-01', value: 0.07 },
			],
			now
		);

		const result = await service.getSeries('IPCA', '2026-07-01', '2026-07-31');

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.points).toEqual([{ date: '2026-07-01', value: 0.07 }]);
		expect(result.extractedAt).toEqual(now);
		expect(result.sourceUrl).toBe(
			'https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json' +
				'&dataInicial=01/07/2026&dataFinal=31/07/2026'
		);
	});

	it('loads a never-synced series once on first read', async () => {
		fetchMock.mockResolvedValue([{ date: '2026-07-01', value: 0.07 }]);

		const result = await service.getSeries('IPCA', '2026-07-01', '2026-07-31');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.points).toEqual([{ date: '2026-07-01', value: 0.07 }]);
	});

	it('returns an empty series with no extraction time when the first load fails', async () => {
		fetchMock.mockRejectedValue(new Error('bacen down'));

		const result = await service.getSeries('IPCA', '2026-07-01', '2026-07-31');

		expect(result.points).toEqual([]);
		expect(result.extractedAt).toBeNull();
	});

	it('shares one sync between concurrent callers', async () => {
		let release!: (points: MacroSeriesPoint[]) => void;
		fetchMock.mockImplementation(
			() => new Promise((resolve) => (release = resolve))
		);

		const first = service.getSeries('CDI', '2026-01-01', '2026-01-31');
		const second = service.getSeries('CDI', '2026-01-01', '2026-01-31');
		await new Promise((resolve) => setImmediate(resolve));
		release([{ date: '2026-01-02', value: 0.05 }]);
		await Promise.all([first, second]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('keeps syncing the other series when one fails', async () => {
		fetchMock.mockImplementation(async (descriptor) => {
			if (descriptor.key === 'IPCA') throw new Error('bacen down');
			return [{ date: '2026-09-25', value: 1 }];
		});

		const result = await service.syncAll();

		expect(result).toEqual({ CDI: 1, IPCA: 'failed', SELIC_META: 1 });
	});
});

describe('todayInSaoPaulo', () => {
	it('uses the Brasília date, not the UTC date', () => {
		// 01h UTC do dia 27 ainda é dia 26 em Brasília.
		expect(todayInSaoPaulo(new Date('2026-09-27T01:00:00.000Z'))).toBe(
			'2026-09-26'
		);
	});
});
