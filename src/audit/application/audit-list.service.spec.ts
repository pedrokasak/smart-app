import { BadRequestException } from '@nestjs/common';
import { AuditListService } from './audit-list.service';
import { AuditTrailService } from './audit-trail.service';
import { InMemoryAuditEventStore } from './in-memory-audit-event.store.fixture';

describe('AuditListService', () => {
	let store: InMemoryAuditEventStore;
	let trail: AuditTrailService;
	let service: AuditListService;
	let clock: Date;

	const record = async (
		eventId: string,
		type = 'security.login.succeeded',
		subject = 'usr_a'
	) => {
		clock = new Date(clock.getTime() + 1000);
		await trail.record({
			eventId,
			type,
			version: 1,
			subject,
			actorRef: subject,
			occurredAt: clock,
			payload: { segredo: 'nao-pode-sair' },
		});
	};

	beforeEach(() => {
		clock = new Date('2026-10-31T12:00:00Z');
		store = new InMemoryAuditEventStore();
		trail = new AuditTrailService(store, () => clock);
		service = new AuditListService(store);
	});

	it('lista do mais novo para o mais antigo, sem o conteúdo', async () => {
		await record('e1');
		await record('e2');

		const page = await service.list({});

		expect(page.items.map((item) => item.eventId)).toEqual(['e2', 'e1']);
		expect(page.nextCursor).toBeNull();
		expect(JSON.stringify(page)).not.toContain('nao-pode-sair');
		expect(page.items[0]).toEqual({
			eventId: 'e2',
			type: 'security.login.succeeded',
			subject: 'usr_a',
			actorRef: 'usr_a',
			occurredAt: '2026-10-31T12:00:02.000Z',
			seq: null,
			hash: null,
			sealed: false,
		});
	});

	it('pagina por cursor sem repetir nem pular evento', async () => {
		for (const id of ['e1', 'e2', 'e3', 'e4', 'e5']) await record(id);

		const first = await service.list({ limit: 2 });
		expect(first.items.map((item) => item.eventId)).toEqual(['e5', 'e4']);
		expect(first.nextCursor).not.toBeNull();

		const second = await service.list({ limit: 2, cursor: first.nextCursor! });
		expect(second.items.map((item) => item.eventId)).toEqual(['e3', 'e2']);

		const third = await service.list({ limit: 2, cursor: second.nextCursor! });
		expect(third.items.map((item) => item.eventId)).toEqual(['e1']);
		expect(third.nextCursor).toBeNull();
	});

	it('filtra por tipo e por assunto', async () => {
		await record('e1', 'security.login.failed', 'usr_a');
		await record('e2', 'security.login.succeeded', 'usr_b');
		await record('e3', 'security.login.failed', 'usr_b');

		expect(
			(await service.list({ type: 'security.login.failed' })).items.map(
				(item) => item.eventId
			)
		).toEqual(['e3', 'e1']);
		expect(
			(await service.list({ subject: 'usr_b' })).items.map(
				(item) => item.eventId
			)
		).toEqual(['e3', 'e2']);
	});

	it('limita a página a 100', async () => {
		const spy = jest.spyOn(store, 'list');
		await service.list({ limit: 5000 });
		expect(spy).toHaveBeenCalledWith({}, 101);
	});

	it('recusa cursor que não é nosso', async () => {
		await expect(service.list({ cursor: 'lixo' })).rejects.toBeInstanceOf(
			BadRequestException
		);
	});
});
