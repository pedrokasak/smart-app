import {
	MongoVoiceConsentAdapter,
	MongoVoiceUsageAdapter,
} from './mongo-voice.adapters';

const exec = (value: unknown) => ({ exec: jest.fn().mockResolvedValue(value) });

describe('MongoVoiceUsageAdapter', () => {
	it('só incrementa abaixo do teto, criando o dia na primeira vez', async () => {
		const model = { updateOne: jest.fn().mockReturnValue(exec({})) };
		const allowed = await new MongoVoiceUsageAdapter(model as any).tryConsume(
			'u1',
			'2026-11-11',
			30
		);

		expect(allowed).toBe(true);
		expect(model.updateOne).toHaveBeenCalledWith(
			{ userId: 'u1', day: '2026-11-11', count: { $lt: 30 } },
			expect.objectContaining({ $inc: { count: 1 } }),
			{ upsert: true }
		);
	});

	it('teto cheio: o upsert bate no índice único e a nova tentativa não casa', async () => {
		const duplicate = Object.assign(new Error('E11000'), { code: 11000 });
		const model = {
			updateOne: jest
				.fn()
				.mockReturnValueOnce({ exec: jest.fn().mockRejectedValue(duplicate) })
				.mockReturnValueOnce(exec({ modifiedCount: 0 })),
		};

		expect(
			await new MongoVoiceUsageAdapter(model as any).tryConsume('u1', 'd', 30)
		).toBe(false);
	});

	it('dois pedidos abrindo o dia juntos: quem perdeu o upsert conta na nova tentativa', async () => {
		const duplicate = Object.assign(new Error('E11000'), { code: 11000 });
		const model = {
			updateOne: jest
				.fn()
				.mockReturnValueOnce({ exec: jest.fn().mockRejectedValue(duplicate) })
				.mockReturnValueOnce(exec({ modifiedCount: 1 })),
		};

		expect(
			await new MongoVoiceUsageAdapter(model as any).tryConsume('u1', 'd', 30)
		).toBe(true);
		expect(model.updateOne).toHaveBeenLastCalledWith(
			{ userId: 'u1', day: 'd', count: { $lt: 30 } },
			{ $inc: { count: 1 } }
		);
	});

	it('outro erro do banco não vira "teto cheio"', async () => {
		const model = {
			updateOne: jest.fn().mockReturnValue({
				exec: jest.fn().mockRejectedValue(new Error('timeout')),
			}),
		};

		await expect(
			new MongoVoiceUsageAdapter(model as any).tryConsume('u1', 'd', 30)
		).rejects.toThrow('timeout');
	});

	it('devolver o turno nunca deixa a contagem negativa', async () => {
		const model = { updateOne: jest.fn().mockReturnValue(exec({})) };
		await new MongoVoiceUsageAdapter(model as any).release('u1', 'd');

		expect(model.updateOne).toHaveBeenCalledWith(
			{ userId: 'u1', day: 'd', count: { $gt: 0 } },
			{ $inc: { count: -1 } }
		);
	});
});

describe('MongoVoiceConsentAdapter', () => {
	it('aceitar de novo limpa a revogação anterior', async () => {
		const model = { updateOne: jest.fn().mockReturnValue(exec({})) };
		const at = new Date('2026-11-12T00:00:00Z');
		await new MongoVoiceConsentAdapter(model as any).accept(
			'u1',
			'voz-v1',
			'web',
			at
		);

		expect(model.updateOne).toHaveBeenCalledWith(
			{ userId: 'u1' },
			{
				$set: {
					version: 'voz-v1',
					origin: 'web',
					acceptedAt: at,
					revokedAt: null,
				},
			},
			{ upsert: true }
		);
	});

	it('revogar diz se havia aceite ativo', async () => {
		const model = {
			updateOne: jest.fn().mockReturnValue(exec({ modifiedCount: 0 })),
		};
		expect(
			await new MongoVoiceConsentAdapter(model as any).revoke('u1', new Date())
		).toBe(false);
	});
});
