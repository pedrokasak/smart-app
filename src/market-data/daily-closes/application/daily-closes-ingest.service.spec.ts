import { cotahistLine } from '../testing/cotahist-fixture';
import {
	DAILY_CLOSES_DEFAULTS,
	DailyClosesConfig,
} from './daily-closes.config';
import { DailyClosesIngestService } from './daily-closes-ingest.service';
import { HeldSymbol } from './ports';

// Quarta-feira, 7 de outubro de 2026.
const NOW = new Date('2026-10-07T15:00:00.000Z');
// Os seis pregões anteriores a NOW, dentro da janela de conferência (7 dias úteis).
const BEFORE_TODAY = [
	'2026-09-29',
	'2026-09-30',
	'2026-10-01',
	'2026-10-02',
	'2026-10-05',
	'2026-10-06',
];

async function* linesOf(...lines: string[]) {
	for (const line of lines) yield line;
}

function build(
	options: {
		held?: HeldSymbol[];
		published?: Record<string, string[]>;
		years?: Record<number, string[]>;
		storedDates?: string[];
		covered?: Record<string, number[]>;
		config?: Partial<DailyClosesConfig>;
	} = {}
) {
	const upserted: { symbol: string; date: string }[] = [];
	const markCovered: { symbols: string[]; year: number }[] = [];
	const store = {
		upsertMany: jest.fn(async (quotes: { symbol: string; date: string }[]) => {
			upserted.push(...quotes);
			return quotes.length;
		}),
		hasDate: jest.fn(async (date: string) =>
			(options.storedDates ?? []).includes(date)
		),
		coveredYears: jest.fn(async () => {
			const map = new Map<string, Set<number>>();
			for (const [symbol, years] of Object.entries(options.covered ?? {})) {
				map.set(symbol, new Set(years));
			}
			return map;
		}),
		markCovered: jest.fn(async (symbols: string[], year: number) => {
			markCovered.push({ symbols, year });
		}),
	};
	const source = {
		fetchDay: jest.fn(async (date: string) =>
			options.published?.[date] ? linesOf(...options.published[date]) : null
		),
		fetchYear: jest.fn(async (year: number) =>
			options.years?.[year] ? linesOf(...options.years[year]) : null
		),
	};
	const held = {
		list: jest.fn(async () => options.held ?? []),
	};
	const config = { ...DAILY_CLOSES_DEFAULTS, ...options.config };
	const service = new DailyClosesIngestService(
		store as any,
		source as any,
		held as any,
		config
	);
	return { service, store, source, upserted, markCovered };
}

const quote = (symbol: string, date: string, close = 10) =>
	cotahistLine({ symbol, date: date.replace(/-/g, ''), close });

describe('DailyClosesIngestService (TRA-251)', () => {
	describe('dia a dia', () => {
		it('grava só os símbolos em carteira (mais o ativo de mercado)', async () => {
			const { service, upserted } = build({
				held: [{ symbol: 'PETR4', since: null }],
				published: {
					'2026-10-07': [
						quote('PETR4', '2026-10-07'),
						quote('VALE3', '2026-10-07'),
						quote('BOVA11', '2026-10-07'),
					],
				},
				storedDates: BEFORE_TODAY,
				covered: { PETR4: [2026], BOVA11: [2025, 2026] },
			});

			const report = await service.run(NOW);

			expect(upserted.map((q) => q.symbol).sort()).toEqual(['BOVA11', 'PETR4']);
			expect(report.days).toEqual([
				{ date: '2026-10-07', published: true, stored: 2 },
			]);
		});

		it('não baixa de novo o dia que já está no banco', async () => {
			const { service, source } = build({
				held: [{ symbol: 'PETR4', since: null }],
				storedDates: [
					'2026-09-29',
					'2026-09-30',
					'2026-10-01',
					'2026-10-02',
					'2026-10-05',
					'2026-10-06',
					'2026-10-07',
				],
				covered: { PETR4: [2026], BOVA11: [2025, 2026] },
			});

			await service.run(NOW);

			expect(source.fetchDay).not.toHaveBeenCalled();
		});

		it('dia sem arquivo (feriado, ainda não publicado) não é erro', async () => {
			const { service } = build({
				held: [{ symbol: 'PETR4', since: null }],
				storedDates: BEFORE_TODAY,
				covered: { PETR4: [2026], BOVA11: [2025, 2026] },
			});

			const report = await service.run(NOW);

			expect(report.days).toEqual([
				{ date: '2026-10-07', published: false, stored: 0 },
			]);
		});

		it('recupera os dias perdidos numa noite em que o job não rodou', async () => {
			const { service, upserted } = build({
				held: [{ symbol: 'PETR4', since: null }],
				published: {
					'2026-10-05': [quote('PETR4', '2026-10-05')],
					'2026-10-06': [quote('PETR4', '2026-10-06')],
					'2026-10-07': [quote('PETR4', '2026-10-07')],
				},
				storedDates: ['2026-10-01', '2026-10-02'],
				covered: { PETR4: [2026], BOVA11: [2025, 2026] },
			});

			await service.run(NOW);

			expect(upserted.map((q) => q.date)).toEqual([
				'2026-10-05',
				'2026-10-06',
				'2026-10-07',
			]);
		});
	});

	describe('histórico (arquivo anual)', () => {
		const allDaysStored = [
			'2026-09-29',
			'2026-09-30',
			'2026-10-01',
			'2026-10-02',
			'2026-10-05',
			'2026-10-06',
			'2026-10-07',
		];

		it('baixa o ano de quem tem negociação antiga, e marca como coberto', async () => {
			const { service, source, upserted, markCovered } = build({
				held: [{ symbol: 'PETR4', since: new Date('2026-02-10') }],
				years: {
					2026: [quote('PETR4', '2026-03-02'), quote('VALE3', '2026-03-02')],
				},
				storedDates: allDaysStored,
			});

			const report = await service.run(NOW);

			expect(source.fetchYear).toHaveBeenCalledWith(2026);
			expect(upserted.map((q) => q.symbol)).toEqual(['PETR4']);
			expect(markCovered).toEqual([
				{ symbols: expect.arrayContaining(['PETR4', 'BOVA11']), year: 2026 },
			]);
			expect(report.years[0]).toMatchObject({ year: 2026, stored: 1 });
		});

		it('começa pelos anos mais recentes e respeita o limite por rodada', async () => {
			const { service, source } = build({
				held: [{ symbol: 'PETR4', since: new Date('2022-06-01') }],
				years: {
					2026: [quote('PETR4', '2026-03-02')],
					2025: [quote('PETR4', '2025-03-03')],
					2024: [quote('PETR4', '2024-03-04')],
				},
				storedDates: allDaysStored,
				config: { maxYearsPerRun: 2 },
			});

			await service.run(NOW);

			expect(source.fetchYear.mock.calls.map(([year]) => year)).toEqual([
				2026, 2025,
			]);
		});

		it('não olha além do limite de anos configurado', async () => {
			const { service, source } = build({
				held: [{ symbol: 'PETR4', since: new Date('2005-01-01') }],
				storedDates: allDaysStored,
				config: { backfillYears: 2, maxYearsPerRun: 5 },
			});

			await service.run(NOW);

			expect(source.fetchYear.mock.calls.map(([year]) => year).sort()).toEqual([
				2024, 2025, 2026,
			]);
		});

		it('ano já coberto para o símbolo não é baixado de novo', async () => {
			const { service, source } = build({
				held: [{ symbol: 'PETR4', since: new Date('2025-02-01') }],
				storedDates: allDaysStored,
				covered: { PETR4: [2025, 2026], BOVA11: [2025, 2026] },
			});

			await service.run(NOW);

			expect(source.fetchYear).not.toHaveBeenCalled();
		});

		it('símbolo novo reabre só o ano em que ele ainda não foi buscado', async () => {
			const { service, source, markCovered } = build({
				held: [
					{ symbol: 'PETR4', since: new Date('2026-01-10') },
					{ symbol: 'ITUB4', since: new Date('2026-01-10') },
				],
				years: { 2026: [quote('ITUB4', '2026-03-02')] },
				storedDates: allDaysStored,
				covered: { PETR4: [2026], BOVA11: [2025, 2026] },
			});

			await service.run(NOW);

			expect(source.fetchYear).toHaveBeenCalledTimes(1);
			expect(markCovered[0].symbols).toEqual(['ITUB4']);
		});

		it('o ano corrente só vale como coberto por 14 dias; anos fechados, sempre', async () => {
			const { service, store } = build({
				held: [{ symbol: 'PETR4', since: new Date('2026-01-10') }],
				storedDates: allDaysStored,
			});

			await service.run(NOW);

			expect(store.coveredYears).toHaveBeenCalledWith(
				expect.arrayContaining(['PETR4', 'BOVA11']),
				2026,
				new Date('2026-09-23T15:00:00.000Z')
			);
		});

		it('ano sem arquivo publicado não marca cobertura (tenta de novo depois)', async () => {
			const { service, markCovered } = build({
				held: [{ symbol: 'PETR4', since: new Date('2026-01-10') }],
				storedDates: allDaysStored,
			});

			const report = await service.run(NOW);

			expect(markCovered).toEqual([]);
			expect(report.years).toEqual([]);
		});

		it('posição sem negociação pede o ano corrente; o ano anterior vem só pelo ativo de mercado', async () => {
			const { service, source } = build({
				held: [{ symbol: 'PETR4', since: null }],
				storedDates: allDaysStored,
			});

			await service.run(NOW);

			expect(source.fetchYear.mock.calls.map(([year]) => year)).toEqual([
				2026, 2025,
			]);
		});

		it('o ativo de mercado acompanha o histórico mais antigo da carteira', async () => {
			const { service, source } = build({
				held: [{ symbol: 'PETR4', since: new Date('2025-03-01') }],
				years: {
					2026: [quote('BOVA11', '2026-03-02')],
					2025: [quote('BOVA11', '2025-03-03')],
				},
				storedDates: allDaysStored,
				covered: { PETR4: [2025, 2026] },
			});

			await service.run(NOW);

			expect(source.fetchYear.mock.calls.map(([year]) => year)).toEqual([
				2026, 2025,
			]);
		});
	});

	it('grava em lotes, sem acumular o arquivo inteiro em memória', async () => {
		const lines = Array.from({ length: 4500 }, (_, i) =>
			cotahistLine({
				symbol: 'PETR4',
				date: `2026${String(1 + (i % 9)).padStart(2, '0')}15`,
				close: 10 + i,
			})
		);
		const { service, store } = build({
			held: [{ symbol: 'PETR4', since: new Date('2026-01-10') }],
			years: { 2026: lines },
			storedDates: [
				'2026-09-29',
				'2026-09-30',
				'2026-10-01',
				'2026-10-02',
				'2026-10-05',
				'2026-10-06',
				'2026-10-07',
			],
		});

		await service.run(NOW);

		expect(store.upsertMany.mock.calls.map(([batch]) => batch.length)).toEqual([
			2000, 2000, 500,
		]);
	});
});
