import { Logger } from '@nestjs/common';
import { EventConsumerRegistry } from './event-consumer.registry';
import { EventConsumer } from './ports/event-consumer.port';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';

describe('EventConsumerRegistry', () => {
	const consumidor = (pattern: string, name = pattern): EventConsumer => ({
		name,
		pattern,
		handle: jest.fn().mockResolvedValue(undefined),
	});

	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => jest.restoreAllMocks());

	it('comeca vazio quando nao ha semente', () => {
		expect(new EventConsumerRegistry().size).toBe(0);
	});

	it('aceita registro depois da construcao (bootstrap de outro modulo)', () => {
		const registry = new EventConsumerRegistry();
		registry.register(consumidor('**', 'notificacoes'));

		expect(registry.size).toBe(1);
		expect(
			registry.forEventType(DOMAIN_EVENT_TYPES.DividendReceived)
		).toHaveLength(1);
	});

	it('roteia so os padroes que casam', () => {
		const registry = new EventConsumerRegistry([
			consumidor('portfolio.**'),
			consumidor('market.**'),
			consumidor(DOMAIN_EVENT_TYPES.DividendReceived),
		]);

		const alvos = registry.forEventType(DOMAIN_EVENT_TYPES.DividendReceived);

		expect(alvos.map((c) => c.name).sort()).toEqual(
			['portfolio.**', DOMAIN_EVENT_TYPES.DividendReceived].sort()
		);
	});

	/**
	 * Registrar duas vezes o mesmo consumidor rodaria o efeito colateral
	 * duas vezes por evento — dois e-mails para a mesma notificacao.
	 */
	it('ignora registro duplicado pelo nome', () => {
		const registry = new EventConsumerRegistry();
		registry.register(consumidor('**', 'notificacoes'));
		registry.register(consumidor('portfolio.**', 'notificacoes'));

		expect(registry.size).toBe(1);
	});
});
