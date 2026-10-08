import { AssetBetaService } from './asset-beta.service';
import { DAILY_CLOSES_DEFAULTS } from './daily-closes.config';

// Série diária de dias úteis terminando perto de NOW.
const NOW = new Date('2026-10-07T15:00:00.000Z');

function weekdaysBack(count: number): string[] {
	const dates: string[] = [];
	const cursor = new Date('2026-10-06T00:00:00.000Z');
	while (dates.length < count) {
		const day = cursor.getUTCDay();
		if (day !== 0 && day !== 6)
			dates.unshift(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() - 1);
	}
	return dates;
}

function priced(dates: string[], multiplier: number) {
	let price = 100;
	return dates.map((date, index) => {
		if (index > 0) price *= 1 + Math.sin(index * 1.7) * 0.012 * multiplier;
		return { date, close: price };
	});
}

function build(series: Record<string, { date: string; close: number }[]>) {
	const writes: unknown[][] = [];
	const store = {
		find: jest.fn(async (symbol: string) => series[symbol] ?? []),
	};
	const held = {
		list: jest.fn(async () =>
			Object.keys(series)
				.filter((symbol) => symbol !== 'BOVA11')
				.map((symbol) => ({ symbol, since: null }))
		),
	};
	const writer = {
		write: jest.fn(async (betas: unknown[]) => {
			writes.push(betas);
			return betas.length;
		}),
	};
	const service = new AssetBetaService(
		store as any,
		held as any,
		writer as any,
		DAILY_CLOSES_DEFAULTS
	);
	return { service, writer, writes };
}

describe('AssetBetaService (TRA-251)', () => {
	const dates = weekdaysBack(300);

	it('calcula o beta de cada ativo contra o BOVA11 e grava com o benchmark', async () => {
		const { service, writes } = build({
			BOVA11: priced(dates, 1),
			PETR4: priced(dates, 2),
		});

		const updated = await service.refresh(NOW);

		expect(updated).toBe(1);
		expect(writes[0]).toEqual([
			{
				symbol: 'PETR4',
				beta: expect.closeTo(2, 1),
				asOf: dates[dates.length - 1],
				benchmark: 'BOVA11',
			},
		]);
	});

	it('sem série do ativo de mercado não atualiza nada (e não apaga o que existe)', async () => {
		const { service, writer } = build({ PETR4: priced(dates, 2) });

		expect(await service.refresh(NOW)).toBe(0);
		expect(writer.write).not.toHaveBeenCalled();
	});

	it('ativo sem histórico suficiente grava beta nulo, em vez de número inventado', async () => {
		const { service, writes } = build({
			BOVA11: priced(dates, 1),
			NOVO3: priced(dates.slice(-30), 2),
		});

		await service.refresh(NOW);

		expect(writes[0]).toEqual([
			expect.objectContaining({ symbol: 'NOVO3', beta: null }),
		]);
	});

	it('o próprio ativo de mercado não recebe beta', async () => {
		const { service, writes } = build({
			BOVA11: priced(dates, 1),
			PETR4: priced(dates, 1),
		});

		await service.refresh(NOW);

		const symbols = (writes[0] as { symbol: string }[]).map((w) => w.symbol);
		expect(symbols).toEqual(['PETR4']);
	});
});
