import { Model, Types } from 'mongoose';
import { ChatMessageDocument } from 'src/ai/chat-history/schema/chat-message.schema';
import { MongoChatEvalSampleSource } from 'src/ai/evaluation/infrastructure/mongo-chat-eval-sample.source';

const SINCE = new Date('2026-09-28T00:00:00.000Z');

function chain<T>(value: T) {
	const query = {
		sort: jest.fn().mockReturnThis(),
		select: jest.fn().mockReturnThis(),
		lean: jest.fn().mockReturnThis(),
		exec: jest.fn().mockResolvedValue(value),
	};
	return query;
}

describe('MongoChatEvalSampleSource (TRA-242)', () => {
	const answerId = new Types.ObjectId();
	let model: { aggregate: jest.Mock; findOne: jest.Mock };

	beforeEach(() => {
		model = {
			aggregate: jest.fn(() => ({
				exec: jest.fn().mockResolvedValue([
					{
						_id: answerId,
						userId: 'user-1',
						createdAt: new Date('2026-10-01T12:00:05.000Z'),
						text: 'Sua carteira apresenta um Score de Risco de 64/100.',
						payload: {
							intent: 'portfolio_risk',
							routing: { mode: 'tool_calling' },
						},
					},
					{
						_id: new Types.ObjectId(),
						userId: 'user-2',
						createdAt: new Date('2026-10-01T13:00:00.000Z'),
						text: 'Resumo da carteira.',
						payload: { intent: 'portfolio_summary' },
					},
				]),
			})),
			findOne: jest
				.fn()
				.mockReturnValueOnce(chain({ text: 'Estou exposto demais a bancos?' }))
				.mockReturnValueOnce(chain(null)),
		};
	});

	const source = () =>
		new MongoChatEvalSampleSource(
			model as unknown as Model<ChatMessageDocument>
		);

	it('pairs each sampled answer with the question that came before it', async () => {
		const samples = await source().sampleChatAnswers(SINCE, 60);

		expect(samples).toEqual([
			{
				id: expect.stringMatching(/^[0-9a-f]{16}$/),
				intent: 'portfolio_risk',
				routingMode: 'tool_calling',
				question: 'Estou exposto demais a bancos?',
				answer: 'Sua carteira apresenta um Score de Risco de 64/100.',
			},
		]);
		expect(model.findOne).toHaveBeenCalledWith({
			userId: 'user-1',
			role: 'user',
			createdAt: { $lte: new Date('2026-10-01T12:00:05.000Z') },
		});
	});

	it('samples only finished answers of the window, never unknown', async () => {
		await source().sampleChatAnswers(SINCE, 60);

		const [match, sample] = model.aggregate.mock.calls[0][0];
		expect(match.$match).toEqual({
			role: 'assistant',
			status: 'ok',
			createdAt: { $gte: SINCE },
			'payload.intent': { $exists: true, $nin: ['unknown', null] },
		});
		expect(sample).toEqual({ $sample: { size: 60 } });
	});

	it('never exposes the user id', async () => {
		const samples = await source().sampleChatAnswers(SINCE, 60);

		expect(JSON.stringify(samples)).not.toContain('user-1');
		expect(samples[0].id).not.toBe(String(answerId));
	});

	it('does nothing for a zero sample', async () => {
		await expect(source().sampleChatAnswers(SINCE, 0)).resolves.toEqual([]);
		expect(model.aggregate).not.toHaveBeenCalled();
	});
});
