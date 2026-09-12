import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { InAppNotificationsService } from './in-app-notifications.service';
import { InAppNotificationsRepository } from '../infrastructure/in-app-notifications.repository';
import { NotificationType } from '../domain/notification.types';

/**
 * Model fake com filtro de verdade.
 *
 * Um mock que devolve array fixo provaria so que o service repassa dados —
 * nunca que o filtro por dono existe. Aqui o fake interpreta o filtro que o
 * repositorio monta, entao esquecer o `user` no filtro faz os testes de
 * autorizacao falharem de imediato, que e o ponto.
 */
type FakeDoc = {
	_id: Types.ObjectId;
	user: Types.ObjectId;
	type: NotificationType;
	payload: Record<string, unknown>;
	readAt: Date | null;
	createdAt: Date;
};

function cmp(a: unknown, b: unknown): number {
	if (a instanceof Date || b instanceof Date) {
		return new Date(a as Date).getTime() - new Date(b as Date).getTime();
	}
	const [x, y] = [String(a), String(b)];
	return x < y ? -1 : x > y ? 1 : 0;
}

function matchValue(value: unknown, cond: unknown): boolean {
	if (cond === null) return value === null || value === undefined;
	if (cond instanceof Types.ObjectId) return String(value) === String(cond);
	if (cond instanceof Date) {
		return value instanceof Date && value.getTime() === cond.getTime();
	}
	if (cond && typeof cond === 'object') {
		return Object.entries(cond as Record<string, unknown>).every(
			([op, operand]) => {
				switch (op) {
					case '$in':
						return (operand as unknown[]).some((o) => matchValue(value, o));
					case '$lt':
						return cmp(value, operand) < 0;
					default:
						throw new Error(`operador nao suportado no fake: ${op}`);
				}
			}
		);
	}
	return value === cond;
}

function matches(doc: FakeDoc, filter: Record<string, unknown>): boolean {
	return Object.entries(filter).every(([key, cond]) => {
		if (key === '$or') {
			return (cond as Record<string, unknown>[]).some((c) => matches(doc, c));
		}
		return matchValue((doc as unknown as Record<string, unknown>)[key], cond);
	});
}

class FakeNotificationModel {
	constructor(public docs: FakeDoc[] = []) {}

	find(filter: Record<string, unknown>) {
		let rows = this.docs.filter((d) => matches(d, filter));
		const chain = {
			sort: () => {
				rows = [...rows].sort(
					(a, b) =>
						cmp(b.createdAt, a.createdAt) || cmp(String(b._id), String(a._id))
				);
				return chain;
			},
			limit: (n: number) => {
				rows = rows.slice(0, n);
				return chain;
			},
			lean: async () => rows,
		};
		return chain;
	}

	async countDocuments(filter: Record<string, unknown>) {
		return this.docs.filter((d) => matches(d, filter)).length;
	}

	findOne(filter: Record<string, unknown>) {
		const found = this.docs.find((d) => matches(d, filter)) ?? null;
		return { lean: async () => found };
	}

	findOneAndUpdate(
		filter: Record<string, unknown>,
		update: { $set: Partial<FakeDoc> }
	) {
		const found = this.docs.find((d) => matches(d, filter)) ?? null;
		if (found) Object.assign(found, update.$set);
		return { lean: async () => found };
	}

	async updateMany(
		filter: Record<string, unknown>,
		update: { $set: Partial<FakeDoc> }
	) {
		const rows = this.docs.filter((d) => matches(d, filter));
		rows.forEach((d) => Object.assign(d, update.$set));
		return { modifiedCount: rows.length };
	}
}

const ALICE = new Types.ObjectId();
const BOB = new Types.ObjectId();

let clock = Date.parse('2026-01-01T00:00:00.000Z');

function makeDoc(overrides: Partial<FakeDoc> = {}): FakeDoc {
	clock += 60_000;
	return {
		_id: new Types.ObjectId(),
		user: ALICE,
		type: NotificationType.DividendReceived,
		payload: {
			type: NotificationType.DividendReceived,
			symbol: 'PETR4',
			amount: 12.5,
		},
		readAt: null,
		createdAt: new Date(clock),
		...overrides,
	};
}

describe('InAppNotificationsService', () => {
	let service: InAppNotificationsService;
	let model: FakeNotificationModel;

	async function build(docs: FakeDoc[]) {
		model = new FakeNotificationModel(docs);
		const moduleRef: TestingModule = await Test.createTestingModule({
			providers: [
				InAppNotificationsService,
				InAppNotificationsRepository,
				{ provide: getModelToken('Notification'), useValue: model },
			],
		}).compile();
		service = moduleRef.get(InAppNotificationsService);
	}

	describe('list()', () => {
		it('devolve os itens do usuario, mais recentes primeiro, no formato do contrato', async () => {
			const older = makeDoc();
			const newer = makeDoc();
			await build([older, newer]);

			const page = await service.list(ALICE.toString());

			expect(page.items.map((i) => i.id)).toEqual([
				newer._id.toString(),
				older._id.toString(),
			]);
			expect(page.items[0]).toEqual({
				id: newer._id.toString(),
				type: NotificationType.DividendReceived,
				title: 'Novo dividendo de PETR4',
				body: expect.stringContaining('PETR4'),
				createdAt: newer.createdAt.toISOString(),
				readAt: null,
				action: { label: 'Ver proventos', route: '/dashboard/proventos' },
			});
			expect(page.nextCursor).toBeNull();
			expect(page.unreadCount).toBe(2);
		});

		it('omite `action` quando o tipo nao rende CTA (payload que o template nao conhece)', async () => {
			const doc = makeDoc({
				payload: { type: 'tipoQueNaoExisteMais' } as Record<string, unknown>,
			});
			await build([doc]);

			const page = await service.list(ALICE.toString());

			expect(page.items).toHaveLength(1);
			expect(page.items[0]).not.toHaveProperty('action');
			expect(page.items[0].title).toBe(NotificationType.DividendReceived);
		});

		it('pagina por cursor sem repetir nem pular itens', async () => {
			const docs = [makeDoc(), makeDoc(), makeDoc(), makeDoc(), makeDoc()];
			await build(docs);

			const first = await service.list(ALICE.toString(), { limit: 2 });
			expect(first.items).toHaveLength(2);
			expect(first.nextCursor).toBeTruthy();

			const second = await service.list(ALICE.toString(), {
				limit: 2,
				cursor: first.nextCursor!,
			});
			const third = await service.list(ALICE.toString(), {
				limit: 2,
				cursor: second.nextCursor!,
			});

			const seen = [...first.items, ...second.items, ...third.items].map(
				(i) => i.id
			);
			expect(seen).toHaveLength(5);
			expect(new Set(seen).size).toBe(5);
			expect(third.nextCursor).toBeNull();
		});

		it('desempata por _id quando duas notificacoes tem o mesmo createdAt', async () => {
			const sameInstant = new Date('2026-02-02T10:00:00.000Z');
			const docs = [
				makeDoc({ createdAt: sameInstant }),
				makeDoc({ createdAt: sameInstant }),
				makeDoc({ createdAt: sameInstant }),
			];
			await build(docs);

			const first = await service.list(ALICE.toString(), { limit: 1 });
			const second = await service.list(ALICE.toString(), {
				limit: 1,
				cursor: first.nextCursor!,
			});
			const thirdPage = await service.list(ALICE.toString(), {
				limit: 1,
				cursor: second.nextCursor!,
			});

			const seen = [
				first.items[0].id,
				second.items[0].id,
				thirdPage.items[0].id,
			];
			expect(new Set(seen).size).toBe(3);
		});

		it('nao vaza item novo inserido entre paginas (keyset, nao offset)', async () => {
			const docs = [makeDoc(), makeDoc(), makeDoc()];
			await build(docs);

			const first = await service.list(ALICE.toString(), { limit: 2 });
			model.docs.push(makeDoc()); // chega uma notificacao no topo
			const second = await service.list(ALICE.toString(), {
				limit: 2,
				cursor: first.nextCursor!,
			});

			const overlap = second.items.filter((i) =>
				first.items.some((f) => f.id === i.id)
			);
			expect(overlap).toEqual([]);
		});

		it('trata cursor invalido como primeira pagina em vez de estourar', async () => {
			await build([makeDoc(), makeDoc()]);

			const page = await service.list(ALICE.toString(), {
				cursor: 'cursor-forjado',
			});

			expect(page.items).toHaveLength(2);
		});

		it('unreadOnly filtra as lidas mas unreadCount continua o total do usuario', async () => {
			const read = makeDoc({ readAt: new Date('2026-01-05T00:00:00.000Z') });
			const unread = makeDoc();
			await build([read, unread]);

			const page = await service.list(ALICE.toString(), { unreadOnly: true });

			expect(page.items.map((i) => i.id)).toEqual([unread._id.toString()]);
			expect(page.unreadCount).toBe(1);
		});

		it('limita o page size ao teto de 50 e usa 20 como default', async () => {
			const docs = Array.from({ length: 60 }, () => makeDoc());
			await build(docs);

			expect((await service.list(ALICE.toString())).items).toHaveLength(20);
			expect(
				(await service.list(ALICE.toString(), { limit: 999 })).items
			).toHaveLength(50);
		});
	});

	describe('unreadCount()', () => {
		it('conta apenas as nao lidas do proprio usuario', async () => {
			await build([
				makeDoc(),
				makeDoc(),
				makeDoc({ readAt: new Date() }),
				makeDoc({ user: BOB }),
				makeDoc({ user: BOB }),
			]);

			expect(await service.unreadCount(ALICE.toString())).toEqual({
				unreadCount: 2,
			});
			expect(await service.unreadCount(BOB.toString())).toEqual({
				unreadCount: 2,
			});
		});

		it('trata doc legado sem readAt como nao lido', async () => {
			const legacy = makeDoc();
			delete (legacy as Partial<FakeDoc>).readAt;
			await build([legacy]);

			expect(await service.unreadCount(ALICE.toString())).toEqual({
				unreadCount: 1,
			});
		});
	});

	describe('markAsRead()', () => {
		it('marca como lida e devolve o item no formato de item da lista', async () => {
			const doc = makeDoc();
			await build([doc]);

			const item = await service.markAsRead(
				ALICE.toString(),
				doc._id.toString()
			);

			expect(item.id).toBe(doc._id.toString());
			expect(item.readAt).not.toBeNull();
			expect(await service.unreadCount(ALICE.toString())).toEqual({
				unreadCount: 0,
			});
		});

		it('e idempotente: marcar de novo nao altera o readAt original', async () => {
			const doc = makeDoc();
			await build([doc]);

			const first = await service.markAsRead(
				ALICE.toString(),
				doc._id.toString()
			);
			const second = await service.markAsRead(
				ALICE.toString(),
				doc._id.toString()
			);

			expect(second.readAt).toBe(first.readAt);
		});

		it('404 quando o id nao e um ObjectId valido', async () => {
			await build([makeDoc()]);
			await expect(
				service.markAsRead(ALICE.toString(), 'nao-e-id')
			).rejects.toBeInstanceOf(NotFoundException);
		});

		it('404 quando a notificacao nao existe', async () => {
			await build([makeDoc()]);
			await expect(
				service.markAsRead(ALICE.toString(), new Types.ObjectId().toString())
			).rejects.toBeInstanceOf(NotFoundException);
		});
	});

	describe('markAllAsRead()', () => {
		it('marca so as nao lidas e devolve quantas mudaram', async () => {
			await build([
				makeDoc(),
				makeDoc(),
				makeDoc({ readAt: new Date('2026-01-03T00:00:00.000Z') }),
			]);

			expect(await service.markAllAsRead(ALICE.toString())).toEqual({
				updated: 2,
			});
			expect(await service.markAllAsRead(ALICE.toString())).toEqual({
				updated: 0,
			});
		});
	});

	/**
	 * O nucleo de seguranca da TRA-136: um usuario nao pode ler nem escrever
	 * a notificacao de outro, em nenhuma das quatro rotas.
	 */
	describe('autorizacao entre usuarios', () => {
		it('list() nunca devolve notificacao de outro usuario', async () => {
			const meus = [makeDoc(), makeDoc()];
			const doBob = [makeDoc({ user: BOB }), makeDoc({ user: BOB })];
			await build([...meus, ...doBob]);

			const page = await service.list(ALICE.toString(), { limit: 50 });

			expect(page.items).toHaveLength(2);
			expect(page.items.map((i) => i.id).sort()).toEqual(
				meus.map((d) => d._id.toString()).sort()
			);
		});

		it('list() com unreadOnly tambem nao atravessa a fronteira de usuario', async () => {
			await build([makeDoc({ user: BOB }), makeDoc({ user: BOB })]);

			const page = await service.list(ALICE.toString(), { unreadOnly: true });

			expect(page.items).toEqual([]);
			expect(page.unreadCount).toBe(0);
		});

		it('cursor do usuario A nao abre a lista do usuario B', async () => {
			const deAlice = [makeDoc(), makeDoc(), makeDoc()];
			const deBob = [makeDoc({ user: BOB }), makeDoc({ user: BOB })];
			await build([...deAlice, ...deBob]);

			const primeira = await service.list(ALICE.toString(), { limit: 1 });
			const comCursorDeOutro = await service.list(BOB.toString(), {
				limit: 50,
				cursor: primeira.nextCursor!,
			});

			expect(
				comCursorDeOutro.items.every((i) =>
					deBob.some((d) => d._id.toString() === i.id)
				)
			).toBe(true);
		});

		it('markAsRead() na notificacao de outro usuario da 404 e nao marca nada', async () => {
			const doBob = makeDoc({ user: BOB });
			await build([makeDoc(), doBob]);

			await expect(
				service.markAsRead(ALICE.toString(), doBob._id.toString())
			).rejects.toBeInstanceOf(NotFoundException);
			expect(doBob.readAt).toBeNull();
			expect(await service.unreadCount(BOB.toString())).toEqual({
				unreadCount: 1,
			});
		});

		it('markAsRead() de outro usuario da 404 tambem quando ela ja esta lida (sem confirmar existencia)', async () => {
			const doBob = makeDoc({
				user: BOB,
				readAt: new Date('2026-01-04T00:00:00.000Z'),
			});
			await build([doBob]);

			await expect(
				service.markAsRead(ALICE.toString(), doBob._id.toString())
			).rejects.toBeInstanceOf(NotFoundException);
		});

		it('markAllAsRead() nao toca nas notificacoes de outro usuario', async () => {
			const deBob = [makeDoc({ user: BOB }), makeDoc({ user: BOB })];
			await build([makeDoc(), ...deBob]);

			expect(await service.markAllAsRead(ALICE.toString())).toEqual({
				updated: 1,
			});
			expect(deBob.every((d) => d.readAt === null)).toBe(true);
			expect(await service.unreadCount(BOB.toString())).toEqual({
				unreadCount: 2,
			});
		});

		it('unreadCount() nao soma notificacoes de outro usuario', async () => {
			await build([makeDoc(), makeDoc({ user: BOB }), makeDoc({ user: BOB })]);

			expect(await service.unreadCount(ALICE.toString())).toEqual({
				unreadCount: 1,
			});
		});
	});
});
