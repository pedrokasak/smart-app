import { EventEmitter } from 'events';

const clients: FakeRedis[] = [];

class FakeRedis extends EventEmitter {
	publish = jest.fn().mockResolvedValue(1);
	subscribe = jest.fn().mockResolvedValue(1);
	connect = jest.fn().mockResolvedValue(undefined);
	disconnect = jest.fn();
	constructor(public options: Record<string, unknown>) {
		super();
		clients.push(this);
	}
}

jest.mock('ioredis', () => ({ Redis: FakeRedis }));

import {
	AGENT_CONTROL_CHANNEL,
	RedisAgentControlSync,
} from './redis-agent-control.sync';

describe('RedisAgentControlSync', () => {
	const connection = { host: 'redis', port: 6379, db: 0 };
	let sync: RedisAgentControlSync;
	let publisher: FakeRedis;
	let subscriber: FakeRedis;

	beforeEach(() => {
		clients.length = 0;
		sync = new RedisAgentControlSync(connection);
		[publisher, subscriber] = clients;
	});

	it('quem publica falha na hora quando o Redis está fora, em vez de enfileirar', () => {
		expect(publisher.options).toMatchObject({
			enableOfflineQueue: false,
			maxRetriesPerRequest: 1,
		});
	});

	it('publica o agente no canal', async () => {
		await sync.publishChanged('ri-watch');
		expect(publisher.publish).toHaveBeenCalledWith(
			AGENT_CONTROL_CHANNEL,
			expect.stringContaining('"agentId":"ri-watch"')
		);
	});

	it('Redis fora não faz publicar lançar', async () => {
		publisher.publish.mockRejectedValue(new Error("Stream isn't writeable"));
		await expect(sync.publishChanged('ri-watch')).resolves.toBeUndefined();
	});

	it('avisa o ouvinte quando OUTRA instância publica', () => {
		const heard: string[] = [];
		sync.subscribe((agentId) => heard.push(agentId));
		expect(subscriber.subscribe).toHaveBeenCalledWith(AGENT_CONTROL_CHANNEL);

		subscriber.emit(
			'message',
			AGENT_CONTROL_CHANNEL,
			JSON.stringify({ agentId: 'ai-eval', from: 'outra-instancia' })
		);
		expect(heard).toEqual(['ai-eval']);
	});

	it('ignora o que a própria instância publicou', async () => {
		const heard: string[] = [];
		sync.subscribe((agentId) => heard.push(agentId));
		await sync.publishChanged('ri-watch');
		const own = publisher.publish.mock.calls[0][1];

		subscriber.emit('message', AGENT_CONTROL_CHANNEL, own);
		expect(heard).toEqual([]);
	});

	it('ignora mensagem quebrada ou sem agente', () => {
		const heard: string[] = [];
		sync.subscribe((agentId) => heard.push(agentId));
		subscriber.emit('message', AGENT_CONTROL_CHANNEL, 'não é json');
		subscriber.emit(
			'message',
			AGENT_CONTROL_CHANNEL,
			JSON.stringify({ from: 'x' })
		);
		expect(heard).toEqual([]);
	});

	it('erro de conexão vira aviso, não exceção sem tratamento', () => {
		expect(() =>
			publisher.emit('error', new Error('ECONNREFUSED'))
		).not.toThrow();
		expect(() =>
			subscriber.emit('error', new Error('ECONNREFUSED'))
		).not.toThrow();
	});

	it('fecha as duas conexões', async () => {
		await sync.close();
		expect(publisher.disconnect).toHaveBeenCalled();
		expect(subscriber.disconnect).toHaveBeenCalled();
	});
});
