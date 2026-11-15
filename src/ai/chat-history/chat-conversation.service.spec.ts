import { NotFoundException } from '@nestjs/common';
import {
	ChatConversationService,
	LEGACY_CONVERSATION_TITLE,
	titleFromQuestion,
} from './chat-conversation.service';

const exec = (value: unknown) => ({ exec: jest.fn().mockResolvedValue(value) });
const ID = '64b7f0c2a1b2c3d4e5f60718';

function setup() {
	const conversations: any = {
		find: jest.fn().mockReturnValue({
			sort: () => ({
				limit: () => ({
					lean: () =>
						exec([
							{
								_id: ID,
								title: 'Risco',
								hasVoice: true,
								createdAt: 1,
								lastMessageAt: 2,
							},
						]),
				}),
			}),
		}),
		create: jest.fn().mockImplementation(async (doc) => ({
			...doc,
			_id: 'new-id',
			toObject: () => ({ ...doc, _id: 'new-id' }),
		})),
		findOneAndUpdate: jest.fn(),
		findOneAndDelete: jest.fn(),
		exists: jest.fn(),
		updateOne: jest.fn().mockReturnValue(exec({})),
	};
	const messages: any = {
		findOne: jest
			.fn()
			.mockReturnValue({ sort: () => ({ lean: () => exec(null) }) }),
		exists: jest.fn().mockReturnValue(exec(null)),
		updateMany: jest.fn().mockReturnValue(exec({})),
		deleteMany: jest.fn().mockReturnValue(exec({ deletedCount: 7 })),
	};
	return {
		service: new ChatConversationService(conversations, messages),
		conversations,
		messages,
	};
}

describe('ChatConversationService', () => {
	it('lista as conversas do usuário, mais recentes primeiro', async () => {
		const { service, conversations } = setup();
		expect(await service.list('u1')).toEqual([
			{
				id: ID,
				title: 'Risco',
				hasVoice: true,
				createdAt: 1,
				lastMessageAt: 2,
			},
		]);
		expect(conversations.find).toHaveBeenCalledWith({ userId: 'u1' });
	});

	it('migração preguiçosa: histórico antigo vira "Conversas anteriores", uma vez', async () => {
		const { service, conversations, messages } = setup();
		messages.findOne.mockReturnValueOnce({
			sort: () => ({ lean: () => exec({ createdAt: new Date('2026-11-01') }) }),
		});
		messages.exists.mockReturnValueOnce(exec({ _id: 'x' }));

		await service.list('u1');

		expect(conversations.create).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				title: LEGACY_CONVERSATION_TITLE,
				hasVoice: true,
				autoTitle: false,
			})
		);
		expect(messages.updateMany).toHaveBeenCalledWith(
			{ userId: 'u1', conversationId: { $exists: false } },
			{ $set: { conversationId: 'new-id' } }
		);

		// Sem mensagem solta, nada a migrar.
		conversations.create.mockClear();
		await service.list('u1');
		expect(conversations.create).not.toHaveBeenCalled();
	});

	it('cria com título automático ou o escolhido', async () => {
		const { service, conversations } = setup();
		await service.create('u1');
		await service.create('u1', 'Planejamento 2027');
		expect(conversations.create.mock.calls[0][0]).toEqual({
			userId: 'u1',
			title: 'Nova conversa',
			autoTitle: true,
		});
		expect(conversations.create.mock.calls[1][0]).toEqual({
			userId: 'u1',
			title: 'Planejamento 2027',
			autoTitle: false,
		});
	});

	it('excluir apaga as mensagens da conversa (LGPD)', async () => {
		const { service, conversations, messages } = setup();
		conversations.findOneAndDelete.mockReturnValue(exec({ _id: ID }));

		expect(await service.remove('u1', ID)).toEqual({ deletedMessages: 7 });
		expect(messages.deleteMany).toHaveBeenCalledWith({
			userId: 'u1',
			conversationId: ID,
		});
	});

	it('conversa de outro usuário ou id inválido responde 404', async () => {
		const { service, conversations, messages } = setup();
		conversations.findOneAndDelete.mockReturnValue(exec(null));
		conversations.exists.mockReturnValue(exec(null));

		await expect(service.remove('u1', ID)).rejects.toBeInstanceOf(
			NotFoundException
		);
		await expect(service.ensureOwned('u1', 'nao-e-id')).rejects.toBeInstanceOf(
			NotFoundException
		);
		expect(messages.deleteMany).not.toHaveBeenCalled();
	});

	it('a primeira pergunta vira o título enquanto ele for o automático', async () => {
		const { service, conversations } = setup();
		await service.touch('u1', ID, {
			voice: true,
			question: 'Quanto a PETR4 pagou?',
		});

		expect(conversations.updateOne).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1' }),
			{ $set: expect.objectContaining({ hasVoice: true }) }
		);
		expect(conversations.updateOne).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', autoTitle: true }),
			{ $set: { title: 'Quanto a PETR4 pagou?', autoTitle: false } }
		);
	});

	it('título automático é curto e numa linha', () => {
		expect(titleFromQuestion('  Quanto\n recebo?  ')).toBe('Quanto recebo?');
		expect(titleFromQuestion('a'.repeat(80))).toHaveLength(60);
		expect(titleFromQuestion('')).toBe('Nova conversa');
	});
});
