import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { InProcessEventBus } from './in-process-event-bus';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { DomainEvent } from 'src/events/domain/domain-event';

describe('InProcessEventBus', () => {
	let bus: InProcessEventBus;

	const dividendo = () =>
		createDomainEvent({
			type: DOMAIN_EVENT_TYPES.DividendReceived,
			subject: 'user-1',
			producer: 'server.dividends',
			payload: { symbol: 'PETR4', amount: 10 },
		});

	beforeEach(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [
				EventEmitterModule.forRoot({
					wildcard: true,
					delimiter: '.',
					newListener: false,
					removeListener: false,
					maxListeners: 50,
				}),
			],
			providers: [InProcessEventBus],
		}).compile();

		await moduleRef.init();
		bus = moduleRef.get(InProcessEventBus);
	});

	it('entrega o envelope intacto ao assinante do tipo exato', async () => {
		const recebidos: DomainEvent[] = [];
		bus.subscribe(DOMAIN_EVENT_TYPES.DividendReceived, (e) => {
			recebidos.push(e);
		});

		const event = dividendo();
		await bus.publish(event);

		expect(recebidos).toEqual([event]);
	});

	it('publish so resolve depois que o assinante assincrono termina', async () => {
		let terminou = false;
		bus.subscribe(DOMAIN_EVENT_TYPES.DividendReceived, async () => {
			await new Promise((r) => setTimeout(r, 10));
			terminou = true;
		});

		await bus.publish(dividendo());

		expect(terminou).toBe(true);
	});

	it('casa curinga de um nivel e de multiplos niveis', async () => {
		const umNivel: string[] = [];
		const multi: string[] = [];
		const tudo: string[] = [];

		bus.subscribe('portfolio.*.received', (e) => {
			umNivel.push(e.id);
		});
		bus.subscribe('portfolio.**', (e) => {
			multi.push(e.id);
		});
		bus.subscribe('**', (e) => {
			tudo.push(e.id);
		});

		const dividendos = dividendo();
		const assinatura = createDomainEvent({
			type: DOMAIN_EVENT_TYPES.SubscriptionExpiring,
			subject: 'user-1',
			producer: 'server.subscription',
			payload: {
				planName: 'PRO',
				expiresAt: new Date().toISOString(),
				daysUntilExpiration: 3,
			},
		});

		await bus.publish(dividendos);
		await bus.publish(assinatura);

		expect(umNivel).toEqual([dividendos.id]);
		expect(multi).toEqual([dividendos.id]);
		expect(tudo).toEqual([dividendos.id, assinatura.id]);
	});

	it('nao entrega a assinante de outro tipo', async () => {
		const outro = jest.fn();
		bus.subscribe(DOMAIN_EVENT_TYPES.QuoteStale, outro);

		await bus.publish(dividendo());

		expect(outro).not.toHaveBeenCalled();
	});

	it('entrega a todos os assinantes do mesmo padrao', async () => {
		const a = jest.fn();
		const b = jest.fn();
		bus.subscribe(DOMAIN_EVENT_TYPES.DividendReceived, a);
		bus.subscribe(DOMAIN_EVENT_TYPES.DividendReceived, b);

		await bus.publish(dividendo());

		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
	});

	it('publicar sem nenhum assinante nao lanca', async () => {
		await expect(bus.publish(dividendo())).resolves.toBeUndefined();
	});

	// Criterio de aceite: "Redis indisponivel nao derruba o request que
	// publicou o evento". O assinante que enfileira e o que fala com o Redis;
	// se ele explodir, publish() ainda resolve.
	it('assinante que lanca nao derruba publish — o erro e logado', async () => {
		const erro = jest
			.spyOn(Logger.prototype, 'error')
			.mockImplementation(() => undefined);
		bus.subscribe(DOMAIN_EVENT_TYPES.DividendReceived, () => {
			throw new Error('Redis indisponivel');
		});

		await expect(bus.publish(dividendo())).resolves.toBeUndefined();
		expect(erro).toHaveBeenCalledWith(
			expect.stringContaining('Redis indisponivel')
		);
		erro.mockRestore();
	});

	it('assinante que rejeita nao derruba publish', async () => {
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		bus.subscribe(DOMAIN_EVENT_TYPES.DividendReceived, async () => {
			throw new Error('falha assincrona');
		});

		await expect(bus.publish(dividendo())).resolves.toBeUndefined();
		jest.restoreAllMocks();
	});
});
