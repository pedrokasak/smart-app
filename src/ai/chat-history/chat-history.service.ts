import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

	async listByUser(userId: string): Promise<ChatMessage[]> {
		// Busca as MAX_HISTORY_MESSAGES mais recentes (desc) e reordena para asc
		// antes de devolver — sem isso, o limit cortaria as mensagens mais
		// novas de uma conversa longa em vez das mais antigas.
		const messages = await this.chatMessageModel
			.find({ userId })
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
		});
		return created.toObject();
	}
}
