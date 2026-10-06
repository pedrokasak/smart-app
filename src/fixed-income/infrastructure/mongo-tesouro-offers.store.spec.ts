import type { Model } from 'mongoose';
import type { TesouroOffersSnapshot } from '../application/ports/tesouro-offers.ports';
import { MongoTesouroOffersStore } from './mongo-tesouro-offers.store';
import type { TesouroOffersSnapshotDocument } from './tesouro-offers-snapshot.model';

const snapshot: TesouroOffersSnapshot = {
	baseDate: '2026-10-02',
	sourceUrl: 'https://www.tesourotransparente.gov.br/x.csv',
	titles: [
		{
			id: 'IPCA_PLUS:2035-05-15',
			family: 'IPCA_PLUS',
			name: 'Tesouro IPCA+ 2035',
			maturityDate: '2035-05-15',
			buyRatePct: 7.55,
			sellRatePct: 7.67,
			unitPrice: 2549.88,
			baseDate: '2026-10-02',
		},
	],
};

function storeWith(stored: unknown) {
	const findExec = jest.fn(async () => stored);
	const replaceExec = jest.fn(async () => ({}));
	const model = {
		findById: jest.fn(() => ({ lean: () => ({ exec: findExec }) })),
		replaceOne: jest.fn(() => ({ exec: replaceExec })),
	};
	return {
		store: new MongoTesouroOffersStore(
			model as unknown as Model<TesouroOffersSnapshotDocument>
		),
		model,
		replaceExec,
	};
}

describe('MongoTesouroOffersStore', () => {
	it('sem documento guardado, devolve null', async () => {
		const { store, model } = storeWith(null);
		await expect(store.load()).resolves.toBeNull();
		expect(model.findById).toHaveBeenCalledWith('latest', { _id: 0 });
	});

	it('lê o documento único e devolve só os campos do contrato', async () => {
		const fetchedAt = new Date('2026-10-05T13:40:00.000Z');
		const { store } = storeWith({
			baseDate: snapshot.baseDate,
			sourceUrl: snapshot.sourceUrl,
			fetchedAt,
			titles: snapshot.titles.map((title) => ({ ...title, extra: 'x' })),
		});

		const loaded = await store.load();
		expect(loaded).toEqual({ ...snapshot, fetchedAt });
		expect(loaded?.titles[0]).not.toHaveProperty('extra');
	});

	it('grava substituindo o documento único (upsert), com a hora da leitura', async () => {
		const { store, model, replaceExec } = storeWith(null);
		const fetchedAt = new Date('2026-10-05T13:40:00.000Z');

		await store.save(snapshot, fetchedAt);

		expect(model.replaceOne).toHaveBeenCalledWith(
			{ _id: 'latest' },
			{ _id: 'latest', ...snapshot, fetchedAt },
			{ upsert: true }
		);
		expect(replaceExec).toHaveBeenCalledTimes(1);
	});
});
