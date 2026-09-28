import { Logger } from '@nestjs/common';
import { SYSTEM_THRESHOLD_POLICY } from 'src/thresholds/domain/threshold-policy';
import { QuoteFreshnessScheduler } from './quote-freshness.scheduler';

describe('QuoteFreshnessScheduler (TRA-136, fase 7)', () => {
	const NOW = new Date('2026-03-05T07:30:00.000Z');

	let userIds: unknown[];
	let portfolioModel: any;
	let refresh: { refresh: jest.Mock };
	let producer: { heldSymbols: jest.Mock; evaluateForUser: jest.Mock };
	let assetPrices: { applyLatestPrices: jest.Mock };

	const criar = () =>
		new QuoteFreshnessScheduler(
			portfolioModel,
			refresh as never,
			producer as never,
			SYSTEM_THRESHOLD_POLICY,
			assetPrices as never
		);

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

		userIds = ['u1', 'u2'];
		portfolioModel = {
			distinct: jest.fn(() => ({
				exec: jest.fn().mockResolvedValue(userIds),
			})),
		};
		refresh = {
			refresh: jest
				.fn()
				.mockResolvedValue({ requested: 2, stamped: 2, records: [] }),
		};
		assetPrices = { applyLatestPrices: jest.fn().mockResolvedValue(0) };
		producer = {
			heldSymbols: jest.fn().mockResolvedValue(['PETR4', 'VALE3']),
			evaluateForUser: jest.fn().mockResolvedValue(1),
		};
	});

	afterEach(() => jest.restoreAllMocks());

	it('o refresh so pede cotacao de simbolo que alguem carrega', async () => {
		await criar().refreshHeldSymbols(NOW);

		expect(refresh.refresh).toHaveBeenCalledWith(['PETR4', 'VALE3'], NOW);
	});

	it('a avaliacao roda por usuario com o corte do sistema', async () => {
		const publicados = await criar().evaluate(NOW);

		expect(publicados).toBe(2);
		expect(producer.evaluateForUser).toHaveBeenCalledTimes(2);
		expect(producer.evaluateForUser).toHaveBeenCalledWith(
			'u1',
			SYSTEM_THRESHOLD_POLICY.quoteStaleAfterMinutes,
			NOW
		);
	});

	it('usuario invalido na lista e ignorado sem derrubar a varredura', async () => {
		userIds = ['u1', null, ''];

		expect(await criar().evaluate(NOW)).toBe(1);
		expect(producer.evaluateForUser).toHaveBeenCalledTimes(1);
	});

	it('o cron nao propaga falha — um dia sem varredura, nao um cron morto', async () => {
		producer.heldSymbols = jest.fn().mockRejectedValue(new Error('mongo fora'));

		await expect(criar().runRefresh()).resolves.toBeUndefined();
	});

	// TRA-247: a leitura chegava ao cache mas nunca as posicoes.
	it('leva a cotacao lida para as posicoes de quem tem o simbolo', async () => {
		const records = [
			{ symbol: 'PETR4', lastQuoteAt: NOW, lastPrice: 38.5, source: 'primary' },
		];
		refresh.refresh.mockResolvedValue({ requested: 2, stamped: 1, records });

		await criar().refreshHeldSymbols(NOW);

		expect(assetPrices.applyLatestPrices).toHaveBeenCalledWith(records);
	});

	it('falha ao gravar nas posicoes nao derruba a varredura', async () => {
		assetPrices.applyLatestPrices.mockRejectedValue(new Error('mongo fora'));

		await expect(criar().refreshHeldSymbols(NOW)).resolves.toMatchObject({
			stamped: 2,
		});
	});

	it('no pregao a varredura reaproveita o mesmo caminho', async () => {
		await criar().runTradingHoursRefresh();

		expect(refresh.refresh).toHaveBeenCalled();
		expect(assetPrices.applyLatestPrices).toHaveBeenCalled();
	});
});
