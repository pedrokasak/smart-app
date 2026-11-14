import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatMessage, ChatMessageDocument } from './schema/chat-message.schema';
import { AppendChatMessageRequestDto } from './dto/append-chat-message-request.dto';

/**
 * Teto de mensagens retornadas no histórico (TRA-66). Sem limite, uma
 * conversa longa vira uma consulta e um payload sem controle a cada load da
 * página — mesmo raciocínio de custo/tamanho do MAX_QUESTION_LENGTH em
 * IntelligentChatRequestDto.
 */
const MAX_HISTORY_MESSAGES = 200;

@Injectable()
export class ChatHistoryService {
	constructor(
		@InjectModel(ChatMessage.name)
		private readonly chatMessageModel: Model<ChatMessageDocument>
	) {}

	async listByUser(
		userId: string,
		conversationId?: string
	): Promise<ChatMessage[]> {
		// Busca as MAX_HISTORY_MESSAGES mais recentes (desc) e reordena para asc
		// antes de devolver — sem isso, o limit cortaria as mensagens mais
		// novas de uma conversa longa em vez das mais antigas.
		const messages = await this.chatMessageModel
			.find(conversationId ? { userId, conversationId } : { userId })
			.sort({ createdAt: -1 })
			.limit(MAX_HISTORY_MESSAGES)
			.lean()
			.exec();
		return messages.reverse();
	}

	async append(
		userId: string,
		dto: AppendChatMessageRequestDto
	): Promise<ChatMessage> {
		const created = await this.chatMessageModel.create({
			userId,
			clientId: dto.clientId,
			role: dto.role,
			text: dto.text,
			status: dto.status,
			retryQuestion: dto.retryQuestion,
			payload: dto.payload,
			aiGenerated: dto.aiGenerated,
			channel: dto.channel,
			conversationId: dto.conversationId,
		});
		return created.toObject();
	}

	/** Última pergunta do usuário na conversa: o contexto do seguimento. */
	async lastUserQuestion(
		userId: string,
		conversationId: string
	): Promise<string | null> {
		const last = await this.chatMessageModel
			.findOne({ userId, conversationId, role: 'user' })
			.sort({ createdAt: -1 })
			.lean()
			.exec();
		return last?.text ?? null;
	}

	/**
	 * Resposta do assistente do próprio usuário, para a voz gerar o áudio a
	 * partir dela (ADR-007, decisão 8). Filtra por `userId`: um id de outra
	 * pessoa responde como inexistente.
	 */
	async findOwnAssistantMessage(
		userId: string,
		messageId: string
	): Promise<ChatMessage | null> {
		if (!Types.ObjectId.isValid(messageId)) return null;
		return this.chatMessageModel
			.findOne({ _id: messageId, userId, role: 'assistant' })
			.lean()
			.exec();
	}
}
