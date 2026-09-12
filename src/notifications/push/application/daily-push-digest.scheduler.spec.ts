import { Types } from 'mongoose';
import {
	NotificationChannelName,
	NotificationDeliveryStatus,
	NotificationType,
} from 'src/notifications/events/domain/notification.types';
import { DailyPushDigestScheduler } from './daily-push-digest.scheduler';

const NOW = new Date('2026-03-10T12:00:00.000Z');
const ALICE = new Types.ObjectId();
const BOB = new Types.ObjectId();

const DIVIDEND = {
	type: NotificationType.DividendReceived,
	symbol: 'ITSA4',
	amount: 10,
};
const INSIGHT = {
	type: NotificationType.AiInsightHigh,
	title: 'Concentracao alta',
	summary: 'Sua carteira concentrou em um setor.',
};

function candidate(user: Types.ObjectId, payload: unknown) {
	return { _id: new Types.ObjectId(), user, payload };
}

/**
 * O scheduler usa `find().select().sort().limit().lean()`. O helper monta a
 * cadeia inteira para nao repetir isso em cada teste.
 */
function findChain(docs: unknown[]) {
	const chain: any = {};
	chain.select = jest.fn(() => chain);
	chain.sort = jest.fn(() => chain);
	chain.limit = jest.fn(() => chain);
	chain.lean = jest.fn().mockResolvedValue(docs);
	return chain;
}

/** `userAllows` real, replicado via stub com preferencias explicitas. */
function notificationsWithPrefs(allowed: NotificationType[]) {
	return {
		userAllows: jest.fn(
			(_user: unknown, type: NotificationType, channel: string) =>
				channel === NotificationChannelName.Push && allowed.includes(type)
		),
	};
}

describe('DailyPushDigestScheduler', () => {
	let notificationModel: any;
	let userModel: any;
	let subscriptions: any;
	let sender: any;

	beforeEach(() => {
		notificationModel = {
			find: jest.fn(),
			updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
		};
		userModel = {
			findById: jest.fn(() => ({
				lean: jest.fn().mockResolvedValue({ _id: ALICE }),
			})),
		};
		subscriptions = {
			findByUser: jest.fn().mockResolvedValue([]),
			deleteByEndpoint: jest.fn().mockResolvedValue(1),
			registerFailure: jest.fn().mockResolvedValue(undefined),
			registerSuccess: jest.fn().mockResolvedValue(undefined),
		};
		sender = {
			isEnabled: jest.fn().mockReturnValue(true),
			publicKey: jest.fn().mockReturnValue('BPUBLIC'),
			send: jest.fn().mockResolvedValue({ outcome: 'sent' }),
		};
	});

	function build(
		notifications: any = notificationsWithPrefs(Object.values(NotificationType))
	) {
		return new DailyPushDigestScheduler(
			notificationModel,
			userModel,
			subscriptions,
			notifications,
			sender
		);
	}

	const SUB = {
		endpoint: 'https://fcm/alice-1',
		keys: { p256dh: 'p', auth: 'a' },
	};

	it('consulta apenas notificacoes deferidas e ainda nao resumidas', async () => {
		notificationModel.find.mockReturnValue(findChain([]));

		await build().dispatch(NOW);

		const filter = notificationModel.find.mock.calls[0][0];
		expect(filter.pushDigestedAt).toBeNull();
		expect(filter.deliveries.$elemMatch).toEqual({
			channel: NotificationChannelName.Push,
			status: NotificationDeliveryStatus.Deferred,
		});
	});

	it('manda UM push por usuario, com o resumo agregado do dia', async () => {
		notificationModel.find.mockReturnValue(
			findChain([
				candidate(ALICE, DIVIDEND),
				candidate(ALICE, INSIGHT),
				candidate(ALICE, DIVIDEND),
			])
		);
		subscriptions.findByUser.mockResolvedValue([SUB]);

		const summary = await build().dispatch(NOW);

		expect(sender.send).toHaveBeenCalledTimes(1);
		expect(sender.send.mock.calls[0][1]).toMatchObject({
			body: '3 novidades na sua carteira',
			count: 3,
		});
		expect(summary.pushed).toBe(1);
	});

	it('um usuario com dois aparelhos recebe o mesmo resumo nos dois', async () => {
		notificationModel.find.mockReturnValue(
			findChain([candidate(ALICE, DIVIDEND)])
		);
		subscriptions.findByUser.mockResolvedValue([
			SUB,
			{ endpoint: 'https://fcm/alice-2', keys: { p256dh: 'p', auth: 'a' } },
		]);

		await build().dispatch(NOW);

		expect(sender.send).toHaveBeenCalledTimes(2);
		expect(sender.send.mock.calls[0][1]).toEqual(sender.send.mock.calls[1][1]);
	});

	it('respeita a preferencia por evento no momento do ENVIO, nao so do fato', async () => {
		notificationModel.find.mockReturnValue(
			findChain([
				candidate(ALICE, DIVIDEND),
				candidate(ALICE, INSIGHT),
				candidate(ALICE, DIVIDEND),
			])
		);
		subscriptions.findByUser.mockResolvedValue([SUB]);

		// O usuario desligou dividendos depois que os eventos foram aceitos.
		await build(
			notificationsWithPrefs([NotificationType.AiInsightHigh])
		).dispatch(NOW);

		expect(sender.send).toHaveBeenCalledTimes(1);
		// Sobrou UMA notificacao permitida: o push vira o deep link dela.
		expect(sender.send.mock.calls[0][1]).toMatchObject({
			count: 1,
			url: '/dashboard/insights',
		});
	});

	it('com todas as preferencias desligadas, nao envia nada', async () => {
		notificationModel.find.mockReturnValue(
			findChain([candidate(ALICE, DIVIDEND)])
		);
		subscriptions.findByUser.mockResolvedValue([SUB]);

		await build(notificationsWithPrefs([])).dispatch(NOW);

		expect(sender.send).not.toHaveBeenCalled();
		// Mesmo assim marca como resumidas: nao viram backlog eterno.
		expect(notificationModel.updateMany).toHaveBeenCalled();
	});

	it('410 Gone apaga a assinatura na hora', async () => {
		notificationModel.find.mockReturnValue(
			findChain([candidate(ALICE, DIVIDEND)])
		);
		subscriptions.findByUser.mockResolvedValue([SUB]);
		sender.send.mockResolvedValue({ outcome: 'expired', statusCode: 410 });

		const summary = await build().dispatch(NOW);

		expect(subscriptions.deleteByEndpoint).toHaveBeenCalledWith(SUB.endpoint);
		expect(summary.removedSubscriptions).toBe(1);
		expect(subscriptions.registerFailure).not.toHaveBeenCalled();
	});

	it('404 tambem apaga', async () => {
		notificationModel.find.mockReturnValue(
			findChain([candidate(ALICE, DIVIDEND)])
		);
		subscriptions.findByUser.mockResolvedValue([SUB]);
		sender.send.mockResolvedValue({ outcome: 'expired', statusCode: 404 });

		await build().dispatch(NOW);

		expect(subscriptions.deleteByEndpoint).toHaveBeenCalledWith(SUB.endpoint);
	});

	it('falha PASSAGEIRA conta mas NAO apaga — 429 do provedor nao zera a base', async () => {
		notificationModel.find.mockReturnValue(
			findChain([candidate(ALICE, DIVIDEND)])
		);
		subscriptions.findByUser.mockResolvedValue([SUB]);
		sender.send.mockResolvedValue({
			outcome: 'transient',
			error: 'too many requests',
			statusCode: 429,
		});

		const summary = await build().dispatch(NOW);

		expect(subscriptions.deleteByEndpoint).not.toHaveBeenCalled();
		expect(subscriptions.registerFailure).toHaveBeenCalledWith(SUB.endpoint);
		expect(summary.removedSubscriptions).toBe(0);
	});

	it('recusa por payload invalido tambem preserva a assinatura', async () => {
		notificationModel.find.mockReturnValue(
			findChain([candidate(ALICE, DIVIDEND)])
		);
		subscriptions.findByUser.mockResolvedValue([SUB]);
		sender.send.mockResolvedValue({
			outcome: 'invalid',
			statusCode: 413,
			error: 'payload too large',
		});

		await build().dispatch(NOW);

		expect(subscriptions.deleteByEndpoint).not.toHaveBeenCalled();
		expect(subscriptions.registerFailure).toHaveBeenCalled();
	});

	it('entrega bem sucedida zera o contador de falhas do endpoint', async () => {
		notificationModel.find.mockReturnValue(
			findChain([candidate(ALICE, DIVIDEND)])
		);
		subscriptions.findByUser.mockResolvedValue([SUB]);

		await build().dispatch(NOW);

		expect(subscriptions.registerSuccess).toHaveBeenCalledWith(SUB.endpoint);
	});

	it('sem VAPID configurado nao tenta enviar e nao quebra a execucao', async () => {
		sender.isEnabled.mockReturnValue(false);
		notificationModel.find.mockReturnValue(
			findChain([candidate(ALICE, DIVIDEND)])
		);
		subscriptions.findByUser.mockResolvedValue([SUB]);

		const summary = await build().dispatch(NOW);

		expect(sender.send).not.toHaveBeenCalled();
		expect(summary.pushed).toBe(0);
		expect(notificationModel.updateMany).toHaveBeenCalled();
	});

	it('usuario sem nenhuma assinatura simplesmente nao recebe push', async () => {
		notificationModel.find.mockReturnValue(
			findChain([candidate(ALICE, DIVIDEND)])
		);
		subscriptions.findByUser.mockResolvedValue([]);

		const summary = await build().dispatch(NOW);

		expect(sender.send).not.toHaveBeenCalled();
		expect(summary.pushed).toBe(0);
	});

	it('marca as notificacoes como resumidas — rodar duas vezes nao reenvia', async () => {
		const docs = [candidate(ALICE, DIVIDEND)];
		notificationModel.find.mockReturnValue(findChain(docs));
		subscriptions.findByUser.mockResolvedValue([SUB]);

		await build().dispatch(NOW);

		const [filter, update] = notificationModel.updateMany.mock.calls[0];
		expect(filter._id.$in).toEqual([docs[0]._id]);
		expect(update.$set.pushDigestedAt).toEqual(NOW);
	});

	it('falha de um usuario nao impede o resumo dos outros', async () => {
		notificationModel.find.mockReturnValue(
			findChain([candidate(ALICE, DIVIDEND), candidate(BOB, DIVIDEND)])
		);
		subscriptions.findByUser.mockResolvedValue([SUB]);
		sender.send
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValue({ outcome: 'sent' });

		const summary = await build().dispatch(NOW);

		expect(summary.pushed).toBe(1);
		// Os dois grupos foram marcados, inclusive o que falhou.
		expect(notificationModel.updateMany).toHaveBeenCalledTimes(2);
	});

	it('sem candidatos nao toca em usuario, assinatura nem sender', async () => {
		notificationModel.find.mockReturnValue(findChain([]));

		const summary = await build().dispatch(NOW);

		expect(summary).toEqual({
			pushed: 0,
			notifications: 0,
			removedSubscriptions: 0,
		});
		expect(userModel.findById).not.toHaveBeenCalled();
		expect(notificationModel.updateMany).not.toHaveBeenCalled();
	});

	it('runDaily engole excecao — um cron morto e pior que um dia sem push', async () => {
		notificationModel.find.mockImplementation(() => {
			throw new Error('mongo fora do ar');
		});

		await expect(build().runDaily()).resolves.toBeUndefined();
	});
});
