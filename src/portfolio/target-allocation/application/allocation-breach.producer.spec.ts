import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { DomainEvent } from 'src/events/domain/domain-event';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { AllocationBreachProducer } from './allocation-breach.producer';

describe('AllocationBreachProducer', () => {
	const userId = new Types.ObjectId().toString();
	const portfolioId = new Types.ObjectId();

	let publicados: DomainEvent[];
	let publisher: { publish: jest.Mock };
	let portfolioModel: any;
	let assetModel: any;

	const chain = (value: unknown) => ({
		select: jest.fn().mockReturnValue({
			lean: jest.fn().mockResolvedValue(value),
		}),
	});

	const comAtivos = (assets: unknown[]) => {
		assetModel.find = jest.fn(() => chain(assets));
	};

	const criar = () =>
		new AllocationBreachProducer(publisher, portfolioModel, assetModel);

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

		publicados = [];
		publisher = {
			publish: jest.fn(async (event: DomainEvent) => {
				publicados.push(event);
			}),
		};
		portfolioModel = { find: jest.fn(() => chain([{ _id: portfolioId }])) };
		assetModel = { find: jest.fn(() => chain([])) };
	});

	afterEach(() => jest.restoreAllMocks());

	it('publica o balde que passou da meta, com meta e real crus', async () => {
		comAtivos([
			{ type: 'crypto', quantity: 1, total: 30 },
			{ type: 'stock', quantity: 1, total: 70 },
		]);

		await criar().evaluateForUser(userId, { crypto: 10, stocks: 80 });

		expect(publicados).toHaveLength(1);
		expect(publicados[0]).toMatchObject({
			type: DOMAIN_EVENT_TYPES.AllocationBreached,
			subject: userId,
			producer: 'server.portfolio.target-allocation',
			payload: { bucket: 'crypto', targetPct: 10, actualPct: 30 },
		});
	});

	it('nao publica nada quando todos os baldes estao dentro da meta', async () => {
		comAtivos([
			{ type: 'crypto', quantity: 1, total: 5 },
			{ type: 'stock', quantity: 1, total: 95 },
		]);

		await criar().evaluateForUser(userId, { crypto: 10 });

		expect(publisher.publish).not.toHaveBeenCalled();
	});

	it('ignora balde sem meta configurada', async () => {
		comAtivos([{ type: 'fii', quantity: 1, total: 100 }]);

		// So `fiis` estourou, mas a meta configurada e de `crypto`.
		await criar().evaluateForUser(userId, { crypto: 10 });

		expect(publisher.publish).not.toHaveBeenCalled();
	});

	it('um evento por balde rompido, cada um com id proprio', async () => {
		comAtivos([
			{ type: 'crypto', quantity: 1, total: 50 },
			{ type: 'fii', quantity: 1, total: 50 },
		]);

		await criar().evaluateForUser(userId, { crypto: 10, fiis: 20 });

		expect(publicados.map((e) => (e.payload as any).bucket).sort()).toEqual([
			'crypto',
			'fiis',
		]);
		expect(publicados[0].id).not.toBe(publicados[1].id);
	});

	it('carteira sem ativos nao gera evento (nada a comparar)', async () => {
		comAtivos([]);

		await criar().evaluateForUser(userId, { crypto: 0 });

		expect(publisher.publish).not.toHaveBeenCalled();
	});

	it('meta ausente e userId invalido saem em silencio', async () => {
		await criar().evaluateForUser(userId, null);
		await criar().evaluateForUser('nao-e-objectid', { crypto: 1 });

		expect(portfolioModel.find).not.toHaveBeenCalled();
	});

	/** Salvar a meta nao pode falhar porque o barramento caiu. */
	it('nao propaga falha do barramento', async () => {
		comAtivos([{ type: 'crypto', quantity: 1, total: 100 }]);
		publisher.publish.mockRejectedValue(new Error('Redis fora do ar'));

		await expect(
			criar().evaluateForUser(userId, { crypto: 10 })
		).resolves.toBeUndefined();
	});
});
