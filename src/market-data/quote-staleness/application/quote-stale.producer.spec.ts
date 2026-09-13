import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { DomainEvent } from 'src/events/domain/domain-event';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { QuoteFreshnessRecord } from '../domain/quote-freshness';
import { QuoteStaleProducer } from './quote-stale.producer';

describe('QuoteStaleProducer (TRA-136, fase 7)', () => {
	const userId = new Types.ObjectId().toString();
	const portfolioId = new Types.ObjectId();
	const NOW = new Date('2026-03-05T12:00:00.000Z');
	const CORTE = 1440;

	let publicados: DomainEvent[];
	let publisher: { publish: jest.Mock };
	let registros: QuoteFreshnessRecord[];
	let simbolosEmCarteira: string[];
	let portfolioModel: any;
	let assetModel: any;
	let freshness: any;

	const criar = () =>
		new QuoteStaleProducer(
			publisher as never,
			freshness,
			portfolioModel,
			assetModel
		);

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

		publicados = [];
		publisher = {
			publish: jest.fn(async (event: DomainEvent) => {
				publicados.push(event);
			}),
		};
		registros = [];
		simbolosEmCarteira = [];

		portfolioModel = {
			find: jest.fn(() => ({
				select: jest.fn(() => ({
					lean: jest.fn().mockResolvedValue([{ _id: portfolioId }]),
				})),
			})),
		};
		assetModel = {
			distinct: jest.fn(() => ({
				exec: jest.fn().mockResolvedValue(simbolosEmCarteira),
			})),
		};
		freshness = {
			recordReads: jest.fn(),
			findBySymbols: jest.fn(async () => registros),
		};
	});

	afterEach(() => jest.restoreAllMocks());

	it('publica simbolo em carteira cuja ultima leitura passou do corte', async () => {
		simbolosEmCarteira = ['PETR4'];
		registros = [
			{
				symbol: 'PETR4',
				lastQuoteAt: new Date('2026-03-03T12:00:00.000Z'), // 48h
			},
		];

		const publicadosCount = await criar().evaluateForUser(userId, CORTE, NOW);

		expect(publicadosCount).toBe(1);
		expect(publicados[0]).toMatchObject({
			type: DOMAIN_EVENT_TYPES.QuoteStale,
			subject: userId,
			producer: 'server.market.quote-freshness',
			payload: {
				symbol: 'PETR4',
				minutesSinceLastQuote: 2880,
				lastQuoteAt: '2026-03-03T12:00:00.000Z',
			},
		});
	});

	/**
	 * O falso positivo mais caro: com a colecao de frescor vazia (primeiro
	 * deploy), tratar "nunca lido" como "parado" alertaria a base inteira.
	 */
	it('simbolo sem registro de leitura nao gera evento', async () => {
		simbolosEmCarteira = ['PETR4', 'XPTO9'];
		registros = [];

		expect(await criar().evaluateForUser(userId, CORTE, NOW)).toBe(0);
		expect(publisher.publish).not.toHaveBeenCalled();
	});

	it('cotacao fresca nao gera evento', async () => {
		simbolosEmCarteira = ['PETR4'];
		registros = [
			{ symbol: 'PETR4', lastQuoteAt: new Date('2026-03-05T09:00:00.000Z') },
		];

		expect(await criar().evaluateForUser(userId, CORTE, NOW)).toBe(0);
	});

	/**
	 * Requisito explicito da issue: nao alertar sobre ativo que ninguem tem.
	 * O registro de frescor e global por simbolo, entao o filtro de posse
	 * precisa acontecer aqui.
	 */
	it('nao publica simbolo que o usuario nao carrega', async () => {
		simbolosEmCarteira = ['PETR4'];
		registros = [
			{ symbol: 'PETR4', lastQuoteAt: new Date('2026-03-03T12:00:00.000Z') },
			{ symbol: 'VALE3', lastQuoteAt: new Date('2026-03-01T12:00:00.000Z') },
		];

		await criar().evaluateForUser(userId, CORTE, NOW);

		expect(publicados.map((e) => (e.payload as any).symbol)).toEqual(['PETR4']);
	});

	it('usuario sem carteira nao consulta frescor', async () => {
		portfolioModel.find = jest.fn(() => ({
			select: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })),
		}));

		expect(await criar().evaluateForUser(userId, CORTE, NOW)).toBe(0);
		expect(freshness.findBySymbols).not.toHaveBeenCalled();
	});

	it('so consulta posicao com quantidade maior que zero', async () => {
		simbolosEmCarteira = ['PETR4'];
		await criar().evaluateForUser(userId, CORTE, NOW);

		expect(assetModel.distinct).toHaveBeenCalledWith(
			'symbol',
			expect.objectContaining({ quantity: { $gt: 0 } })
		);
	});

	it('id e deterministico por episodio e dia — a segunda varredura repete o id', async () => {
		simbolosEmCarteira = ['PETR4'];
		registros = [
			{ symbol: 'PETR4', lastQuoteAt: new Date('2026-03-03T12:00:00.000Z') },
		];

		await criar().evaluateForUser(userId, CORTE, NOW);
		await criar().evaluateForUser(
			userId,
			CORTE,
			new Date('2026-03-05T18:00:00.000Z')
		);

		expect(publicados).toHaveLength(2);
		expect(publicados[0].id).toBe(publicados[1].id);
	});

	it('dia seguinte gera id novo, para nao brigar com o re-arme por cooldown', async () => {
		simbolosEmCarteira = ['PETR4'];
		registros = [
			{ symbol: 'PETR4', lastQuoteAt: new Date('2026-03-03T12:00:00.000Z') },
		];

		await criar().evaluateForUser(userId, CORTE, NOW);
		await criar().evaluateForUser(
			userId,
			CORTE,
			new Date('2026-03-06T12:00:00.000Z')
		);

		expect(publicados[0].id).not.toBe(publicados[1].id);
	});

	it('userId invalido nao consulta nada', async () => {
		expect(await criar().evaluateForUser('nao-e-id', CORTE, NOW)).toBe(0);
		expect(portfolioModel.find).not.toHaveBeenCalled();
	});

	it('falha de leitura nao derruba a varredura', async () => {
		simbolosEmCarteira = ['PETR4'];
		freshness.findBySymbols = jest.fn(async () => {
			throw new Error('mongo fora');
		});

		expect(await criar().evaluateForUser(userId, CORTE, NOW)).toBe(0);
	});

	it('heldSymbols devolve os simbolos com posicao, normalizados e unicos', async () => {
		simbolosEmCarteira = [' petr4 ', 'PETR4', 'vale3', ''];

		expect(await criar().heldSymbols()).toEqual(['PETR4', 'VALE3']);
		expect(assetModel.distinct).toHaveBeenCalledWith('symbol', {
			quantity: { $gt: 0 },
		});
	});
});
