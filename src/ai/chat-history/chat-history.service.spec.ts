import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ChatHistoryService } from './chat-history.service';
import { ChatMessage } from './schema/chat-message.schema';

describe('ChatHistoryService', () => {
	let service: ChatHistoryService;

	const mockChatMessageModel = {
		find: jest.fn(),
		create: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ChatHistoryService,
				{
					provide: getModelToken(ChatMessage.name),
					useValue: mockChatMessageModel,
				},
			],
		}).compile();

		service = module.get<ChatHistoryService>(ChatHistoryService);
	});

	afterEach(() => jest.clearAllMocks());

	it('should be defined', () => {
		expect(service).toBeDefined();
	});

	describe('recentUserQuestions', () => {
		it('busca só perguntas da conversa, poucas, e devolve da mais antiga para a mais nova', async () => {
			const exec = jest
				.fn()
				.mockResolvedValue([
					{ text: 'e a ITUB4?' },
					{ text: 'e a VALE3?' },
					{ text: 'Quanto a PETR4 pagou?' },
				]);
			const lean = jest.fn().mockReturnValue({ exec });
			const select = jest.fn().mockReturnValue({ lean });
			const limit = jest.fn().mockReturnValue({ select });
			const sort = jest.fn().mockReturnValue({ limit });
			mockChatMessageModel.find.mockReturnValue({ sort });

			const result = await service.recentUserQuestions('u1', 'conv-1');

			expect(mockChatMessageModel.find).toHaveBeenCalledWith({
				userId: 'u1',
				conversationId: 'conv-1',
				role: 'user',
			});
			expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
			expect(limit).toHaveBeenCalledWith(5);
			expect(result).toEqual([
				'Quanto a PETR4 pagou?',
				'e a VALE3?',
				'e a ITUB4?',
			]);
		});
	});

	describe('listByUser', () => {
		it('busca as mensagens mais recentes e devolve em ordem cronologica', async () => {
			const descOrder = [
				{ userId: 'u1', text: 'terceira', createdAt: new Date(3) },
				{ userId: 'u1', text: 'segunda', createdAt: new Date(2) },
				{ userId: 'u1', text: 'primeira', createdAt: new Date(1) },
			];
			const exec = jest.fn().mockResolvedValue(descOrder);
			const lean = jest.fn().mockReturnValue({ exec });
			const limit = jest.fn().mockReturnValue({ lean });
			const sort = jest.fn().mockReturnValue({ limit });
			mockChatMessageModel.find.mockReturnValue({ sort });

			const result = await service.listByUser('u1');

			expect(mockChatMessageModel.find).toHaveBeenCalledWith({
				userId: 'u1',
			});
			expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
			expect(result.map((m) => m.text)).toEqual([
				'primeira',
				'segunda',
				'terceira',
			]);
		});
	});

	describe('append', () => {
		it('cria a mensagem associada ao userId autenticado', async () => {
			const toObject = jest.fn().mockReturnValue({
				userId: 'u1',
				clientId: 'c-1',
				role: 'user',
				text: 'oi',
			});
			mockChatMessageModel.create.mockResolvedValue({ toObject });

			const result = await service.append('u1', {
				clientId: 'c-1',
				role: 'user',
				text: 'oi',
			});

			expect(mockChatMessageModel.create).toHaveBeenCalledWith(
				expect.objectContaining({
					userId: 'u1',
					clientId: 'c-1',
					role: 'user',
					text: 'oi',
				})
			);
			expect(result).toEqual({
				userId: 'u1',
				clientId: 'c-1',
				role: 'user',
				text: 'oi',
			});
		});
	});
});
