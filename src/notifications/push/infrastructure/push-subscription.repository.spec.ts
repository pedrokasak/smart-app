import { Types } from 'mongoose';
import { PushSubscriptionRepository } from './push-subscription.repository';

const ALICE = new Types.ObjectId();
const BOB = new Types.ObjectId();

describe('PushSubscriptionRepository', () => {
	const model = {
		updateOne: jest.fn().mockResolvedValue({}),
		deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
		find: jest.fn(),
	};

	const repository = new PushSubscriptionRepository(model as any);

	beforeEach(() => {
		jest.clearAllMocks();
		model.deleteOne.mockResolvedValue({ deletedCount: 0 });
	});

	it('upsert por endpoint: o navegador reenviando a mesma assinatura nao duplica', async () => {
		await repository.upsert({
			userId: ALICE,
			endpoint: 'https://fcm/abc',
			keys: { p256dh: 'p', auth: 'a' },
		});

		const [filter, update, options] = model.updateOne.mock.calls[0];
		expect(filter).toEqual({ endpoint: 'https://fcm/abc' });
		expect(options).toEqual({ upsert: true });
		expect(update.$set.failureCount).toBe(0);
		expect(String(update.$set.user)).toBe(ALICE.toString());
	});

	it('remocao pelo usuario SEMPRE carrega o dono no filtro', async () => {
		await repository.removeForUser(ALICE, 'https://fcm/do-bob');

		expect(model.deleteOne).toHaveBeenCalledWith({
			user: ALICE,
			endpoint: 'https://fcm/do-bob',
		});
	});

	it('Bob nao consegue apagar a assinatura da Alice mesmo sabendo o endpoint', async () => {
		// O model devolve 0 porque o filtro por `user` nao casa. O ponto do
		// teste e o filtro: nao existe caminho de usuario que apague so por
		// endpoint.
		const removed = await repository.removeForUser(BOB, 'https://fcm/da-alice');

		expect(removed).toBe(0);
		expect(model.deleteOne.mock.calls[0][0].user).toBe(BOB);
	});

	it('a remocao sem dono existe apenas para assinatura morta (404/410)', async () => {
		model.deleteOne.mockResolvedValue({ deletedCount: 1 });

		await expect(
			repository.deleteByEndpoint('https://fcm/morto')
		).resolves.toBe(1);
		expect(model.deleteOne).toHaveBeenCalledWith({
			endpoint: 'https://fcm/morto',
		});
	});

	it('falha transitoria apenas incrementa o contador', async () => {
		await repository.registerFailure('https://fcm/abc');

		expect(model.updateOne).toHaveBeenCalledWith(
			{ endpoint: 'https://fcm/abc' },
			{ $inc: { failureCount: 1 } }
		);
		expect(model.deleteOne).not.toHaveBeenCalled();
	});

	it('sucesso zera o contador de falhas', async () => {
		await repository.registerSuccess('https://fcm/abc');

		const [, update] = model.updateOne.mock.calls[0];
		expect(update.$set.failureCount).toBe(0);
		expect(update.$set.lastSeenAt).toBeInstanceOf(Date);
	});

	it('agrupa assinaturas por usuario em uma consulta so', async () => {
		model.find.mockReturnValue({
			lean: jest.fn().mockResolvedValue([
				{ user: ALICE, endpoint: 'a1' },
				{ user: ALICE, endpoint: 'a2' },
				{ user: BOB, endpoint: 'b1' },
			]),
		});

		const grouped = await repository.findByUsers([ALICE, BOB]);

		expect(model.find).toHaveBeenCalledTimes(1);
		expect(grouped.get(ALICE.toString())).toHaveLength(2);
		expect(grouped.get(BOB.toString())).toHaveLength(1);
	});
});
