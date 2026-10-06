import type {
	StoredTesouroOffers,
	TesouroOffersSnapshot,
	TesouroOffersSource,
	TesouroOffersStore,
} from './ports/tesouro-offers.ports';
import { TesouroOffersService } from './tesouro-offers.service';

const snapshot = (baseDate: string): TesouroOffersSnapshot => ({
	baseDate,
	sourceUrl: 'https://www.tesourotransparente.gov.br/x.csv',
	titles: [
		{
			id: 'SELIC:2031-03-01',
			family: 'SELIC',
			name: 'Tesouro Selic 2031',
			maturityDate: '2031-03-01',
			buyRatePct: 0.09,
			sellRatePct: 0.1,
			unitPrice: 19943.12,
			baseDate,
		},
	],
});

class MemoryStore implements TesouroOffersStore {
	saved: StoredTesouroOffers | null = null;
	saves = 0;
	async load() {
		return this.saved;
	}
	async save(next: TesouroOffersSnapshot, fetchedAt: Date) {
		this.saves += 1;
		this.saved = { ...next, fetchedAt };
	}
}

const NOW = new Date('2026-10-05T13:00:00.000Z'); // 10h em Brasília

function build(
	source: Partial<TesouroOffersSource>,
	store = new MemoryStore()
) {
	const fetchLatest = jest.fn(
		source.fetchLatest ?? (async () => snapshot('2026-10-02'))
	);
	const service = new TesouroOffersService({ fetchLatest }, store, () => NOW);
	return { service, store, fetchLatest };
}

describe('TesouroOffersService', () => {
	it('sem nada guardado, lê a fonte uma vez, grava e devolve', async () => {
		const { service, store, fetchLatest } = build({});
		const offers = await service.getOffers();

		expect(offers?.baseDate).toBe('2026-10-02');
		expect(offers?.fetchedAt).toEqual(NOW);
		expect(offers?.stale).toBe(false);
		expect(store.saves).toBe(1);
		expect(fetchLatest).toHaveBeenCalledTimes(1);

		await service.getOffers();
		expect(fetchLatest).toHaveBeenCalledTimes(1); // segunda leitura vem do banco
	});

	it('com pregão guardado, não toca na fonte', async () => {
		const store = new MemoryStore();
		store.saved = {
			...snapshot('2026-10-02'),
			fetchedAt: new Date('2026-10-03T00:00:00Z'),
		};
		const { service, fetchLatest } = build({}, store);
		const offers = await service.getOffers();
		expect(offers?.baseDate).toBe('2026-10-02');
		expect(fetchLatest).not.toHaveBeenCalled();
	});

	it('marca como desatualizado o pregão com mais de sete dias', async () => {
		const store = new MemoryStore();
		store.saved = {
			...snapshot('2026-09-25'),
			fetchedAt: new Date('2026-09-26T00:00:00Z'),
		};
		const { service } = build({}, store);
		expect((await service.getOffers())?.stale).toBe(true);

		store.saved = {
			...snapshot('2026-09-28'),
			fetchedAt: new Date('2026-09-29T00:00:00Z'),
		};
		expect((await service.getOffers())?.stale).toBe(false);
	});

	it('nada guardado e fonte fora do ar: devolve null, não lança', async () => {
		const { service } = build({
			fetchLatest: async () => {
				throw new Error('HTTP 503');
			},
		});
		await expect(service.getOffers()).resolves.toBeNull();
	});

	it('refresh simultâneo compartilha uma única leitura da fonte', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { service, fetchLatest } = build({
			fetchLatest: async () => {
				await gate;
				return snapshot('2026-10-02');
			},
		});

		const first = service.refresh();
		const second = service.refresh();
		release();
		await Promise.all([first, second]);
		expect(fetchLatest).toHaveBeenCalledTimes(1);
	});

	it('nunca troca um pregão por outro mais antigo', async () => {
		const store = new MemoryStore();
		store.saved = {
			...snapshot('2026-10-02'),
			fetchedAt: new Date('2026-10-03T00:00:00Z'),
		};
		const { service } = build(
			{ fetchLatest: async () => snapshot('2026-09-30') },
			store
		);

		const result = await service.refresh();
		expect(result.baseDate).toBe('2026-10-02');
		expect(store.saves).toBe(0);
	});

	it('refresh com falha da fonte mantém o que estava guardado', async () => {
		const store = new MemoryStore();
		store.saved = {
			...snapshot('2026-10-02'),
			fetchedAt: new Date('2026-10-03T00:00:00Z'),
		};
		const { service } = build(
			{
				fetchLatest: async () => {
					throw new Error('timeout');
				},
			},
			store
		);
		await expect(service.refresh()).rejects.toThrow('timeout');
		expect(store.saved?.baseDate).toBe('2026-10-02');
		// E a leitura para a tela continua servindo o pregão guardado.
		expect((await service.getOffers())?.baseDate).toBe('2026-10-02');
	});
});
