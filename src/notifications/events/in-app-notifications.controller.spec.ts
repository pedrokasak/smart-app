import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { InAppNotificationsController } from './in-app-notifications.controller';
import { InAppNotificationsService } from './application/in-app-notifications.service';
import { ListInAppNotificationsQueryDto } from './dto/list-in-app-notifications-query.dto';

/**
 * Mesmo padrao dos outros specs de controller do repo: o guard real puxa
 * JwtService/TokenBlacklistService e nao cabe num teste unitario. O que se
 * prova aqui e o escopo por usuario dentro do handler; a protecao da rota
 * pelo guard e coberta em jwt-auth.guard.spec.ts.
 */
jest.mock('../../env.ts', () => ({
	jwtSecret: 'fake-jwt-secret-para-teste',
}));

jest.mock('../../authentication/jwt-auth.guard', () => ({
	JwtAuthGuard: jest.fn().mockImplementation(() => true),
}));

const ALICE = new Types.ObjectId().toString();
const BOB = new Types.ObjectId().toString();

describe('InAppNotificationsController', () => {
	const serviceMock = {
		list: jest.fn(),
		unreadCount: jest.fn(),
		markAsRead: jest.fn(),
		markAllAsRead: jest.fn(),
	};

	let controller: InAppNotificationsController;

	beforeEach(async () => {
		jest.clearAllMocks();
		serviceMock.list.mockResolvedValue({
			items: [],
			nextCursor: null,
			unreadCount: 0,
		});
		serviceMock.unreadCount.mockResolvedValue({ unreadCount: 0 });
		serviceMock.markAsRead.mockResolvedValue({ id: 'x' });
		serviceMock.markAllAsRead.mockResolvedValue({ updated: 0 });

		const moduleRef: TestingModule = await Test.createTestingModule({
			controllers: [InAppNotificationsController],
			providers: [
				{ provide: InAppNotificationsService, useValue: serviceMock },
			],
		}).compile();

		controller = moduleRef.get(InAppNotificationsController);
	});

	it('repassa limit, cursor e unreadOnly da query', async () => {
		const query: ListInAppNotificationsQueryDto = {
			limit: 10,
			cursor: 'abc',
			unreadOnly: true,
		};

		await controller.list({ user: { userId: ALICE } }, query);

		expect(serviceMock.list).toHaveBeenCalledWith(ALICE, {
			limit: 10,
			cursor: 'abc',
			unreadOnly: true,
		});
	});

	it.each([
		['userId', { userId: ALICE }],
		['sub', { sub: ALICE }],
		['_id', { _id: ALICE }],
		['id', { id: ALICE }],
	])('aceita o formato de payload de JWT com %s', async (_label, user) => {
		await controller.unreadCount({ user });
		expect(serviceMock.unreadCount).toHaveBeenCalledWith(ALICE);
	});

	/**
	 * Regressao de autorizacao: o dono sai do JWT e de mais lugar nenhum. Se
	 * alguem um dia ler o `userId` da query ou do body, estes testes quebram.
	 */
	describe('escopo do usuario', () => {
		it('ignora um userId injetado na query da listagem', async () => {
			await controller.list({ user: { userId: ALICE } }, {
				limit: 5,
				userId: BOB,
			} as ListInAppNotificationsQueryDto & { userId: string });

			expect(serviceMock.list).toHaveBeenCalledWith(ALICE, {
				limit: 5,
				cursor: undefined,
				unreadOnly: undefined,
			});
			expect(serviceMock.list.mock.calls[0][0]).not.toBe(BOB);
		});

		it('usa o usuario do JWT no unread-count, nao o da query', async () => {
			await controller.unreadCount({
				user: { userId: ALICE },
				query: { userId: BOB },
			});

			expect(serviceMock.unreadCount).toHaveBeenCalledWith(ALICE);
		});

		it('usa o usuario do JWT ao marcar uma notificacao como lida', async () => {
			const notificationId = new Types.ObjectId().toString();

			await controller.markAsRead(
				{ user: { userId: ALICE }, body: { userId: BOB } },
				notificationId
			);

			expect(serviceMock.markAsRead).toHaveBeenCalledWith(
				ALICE,
				notificationId
			);
		});

		it('usa o usuario do JWT no read-all', async () => {
			await controller.markAllAsRead({
				user: { userId: ALICE },
				body: { userId: BOB },
			});

			expect(serviceMock.markAllAsRead).toHaveBeenCalledWith(ALICE);
		});

		it('sem usuario no request, repassa string vazia — o service e quem recusa', async () => {
			await controller.unreadCount({});
			expect(serviceMock.unreadCount).toHaveBeenCalledWith('');
		});
	});
});
