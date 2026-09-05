import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { DomainEvent } from 'src/events/domain/domain-event';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { DividendReceivedProducer } from './dividend-received.producer';

describe('DividendReceivedProducer', () => {
	const userId = new Types.ObjectId();
	const portfolioId = new Types.ObjectId();

	let publicados: DomainEvent[];
	let publisher: { publish: jest.Mock };
	let assetModel: any;
	let portfolioModel: any;

	const chain = (value: unknown) => ({
		select: jest.fn().mockReturnValue({
			lean: jest.fn().mockResolvedValue(value),
		}),
	});

	const criar = () =>
		new DividendReceivedProducer(publisher, assetModel, portfolioModel);

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

		publicados = [];
		publisher = {
			publish: jest.fn(async (event: DomainEvent) => {
				publicados.push(event);
			}),
		};
		assetModel = {
			findById: jest.fn(() => chain({ symbol: 'PETR4', portfolioId })),
		};
		portfolioModel = { findById: jest.fn(() => chain({ userId })) };
	});

	afterEach(() => jest.restoreAllMocks());

	it('publica um evento por provento, com o dono da carteira no subject', async () => {
		await criar().publishForAsset('asset-1', [
			{ date: new Date('2026-08-10T00:00:00Z'), value: 1.25 },
			{ date: new Date('2026-08-20T00:00:00Z'), value: 2.5 },
		]);

		expect(publicados).toHaveLength(2);
		expect(publicados[0]).toMatchObject({
			type: DOMAIN_EVENT_TYPES.DividendReceived,
			subject: userId.toString(),
			producer: 'server.assets.dividends',
			payload: { symbol: 'PETR4', amount: 1.25, currency: 'BRL' },
		});
	});

	/**
	 * `id` vem do produtor, nunca do transporte — e o que sustenta a
	 * idempotencia do consumidor e o outbox transacional mais adiante.
	 */
	it('cada evento nasce com id proprio e occurredAt na data do provento', async () => {
		await criar().publishForAsset('asset-1', [
			{ date: '2026-08-10T00:00:00.000Z', value: 1 },
			{ date: '2026-08-11T00:00:00.000Z', value: 1 },
		]);

		expect(publicados[0].id).toBeTruthy();
		expect(publicados[0].id).not.toBe(publicados[1].id);
		expect(publicados[0].occurredAt).toBe('2026-08-10T00:00:00.000Z');
	});

	it('ignora provento de valor nao positivo', async () => {
		await criar().publishForAsset('asset-1', [
			{ date: new Date(), value: 0 },
			{ date: new Date(), value: -1 },
		]);

		expect(publisher.publish).not.toHaveBeenCalled();
	});

	it('corta o lote de importacao em 5 eventos', async () => {
		const entries = Array.from({ length: 12 }, (_, i) => ({
			date: new Date(2026, 0, i + 1),
			value: 1,
		}));

		await criar().publishForAsset('asset-1', entries);

		expect(publicados).toHaveLength(5);
	});

	it('nao publica quando a carteira nao tem dono', async () => {
		portfolioModel.findById = jest.fn(() => chain({}));

		await criar().publishForAsset('asset-1', [{ date: new Date(), value: 1 }]);

		expect(publisher.publish).not.toHaveBeenCalled();
	});

	/**
	 * Criterio de aceite: barramento fora do ar nao derruba quem gravou o
	 * provento. O produtor engole a falha e loga.
	 */
	it('nao propaga falha do barramento para quem gravou o provento', async () => {
		publisher.publish.mockRejectedValue(new Error('Redis fora do ar'));

		await expect(
			criar().publishForAsset('asset-1', [{ date: new Date(), value: 1 }])
		).resolves.toBeUndefined();
	});

	it('nao propaga falha de consulta ao Mongo', async () => {
		assetModel.findById = jest.fn(() => {
			throw new Error('mongo caiu');
		});

		await expect(
			criar().publishForAsset('asset-1', [{ date: new Date(), value: 1 }])
		).resolves.toBeUndefined();
	});
});
