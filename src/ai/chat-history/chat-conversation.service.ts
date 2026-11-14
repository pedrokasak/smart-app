import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatMessage, ChatMessageDocument } from './schema/chat-message.schema';
import {
	ChatConversation,
	ChatConversationDocument,
} from './schema/chat-conversation.schema';

export const NEW_CONVERSATION_TITLE = 'Nova conversa';
export const LEGACY_CONVERSATION_TITLE = 'Conversas anteriores';
const TITLE_MAX = 60;

export interface ChatConversationView {
	id: string;
	title: string;
	hasVoice: boolean;
	createdAt: Date;
	lastMessageAt: Date;
}

/** Título automático: a primeira pergunta, numa linha e curta. */
export function titleFromQuestion(question: string): string {
	const line = String(question || '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!line) return NEW_CONVERSATION_TITLE;
	return line.length > TITLE_MAX
		? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…`
		: line;
}

/**
 * Conversas do Chat Inteligente (ADR-007, fase 2). Toda operação filtra por
 * `userId`: conversa de outra pessoa responde como inexistente (404).
 */
@Injectable()
export class ChatConversationService {
	constructor(
		@InjectModel(ChatConversation.name)
		private readonly conversations: Model<ChatConversationDocument>,
		@InjectModel(ChatMessage.name)
		private readonly messages: Model<ChatMessageDocument>
	) {}

	async list(userId: string): Promise<ChatConversationView[]> {
		await this.adoptLegacyMessages(userId);
		const docs = await this.conversations
			.find({ userId })
			.sort({ lastMessageAt: -1 })
			.limit(100)
			.lean()
			.exec();
		return docs.map(toView);
	}

	async create(userId: string, title?: string): Promise<ChatConversationView> {
		const custom = String(title || '').trim();
		const created = await this.conversations.create({
			userId,
			title: custom ? custom.slice(0, 120) : NEW_CONVERSATION_TITLE,
			autoTitle: !custom,
		});
		return toView(created.toObject());
	}

	async rename(
		userId: string,
		id: string,
		title: string
	): Promise<ChatConversationView> {
		const updated = await this.conversations
			.findOneAndUpdate(
				{ _id: this.objectId(id), userId },
				{ $set: { title: title.trim().slice(0, 120), autoTitle: false } },
				{ new: true }
			)
			.lean()
			.exec();
		if (!updated) throw new NotFoundException('conversation_not_found');
		return toView(updated);
	}

	/** Apaga a conversa e as mensagens dela (direito de eliminação, LGPD). */
	async remove(
		userId: string,
		id: string
	): Promise<{ deletedMessages: number }> {
		const deleted = await this.conversations
			.findOneAndDelete({ _id: this.objectId(id), userId })
			.exec();
		if (!deleted) throw new NotFoundException('conversation_not_found');
		const result = await this.messages
			.deleteMany({ userId, conversationId: id })
			.exec();
		return { deletedMessages: result.deletedCount ?? 0 };
	}

	/** Confere o dono; de outro usuário ou inexistente, o mesmo 404. */
	async ensureOwned(userId: string, id: string): Promise<void> {
		const exists = await this.conversations
			.exists({ _id: this.objectId(id), userId })
			.exec();
		if (!exists) throw new NotFoundException('conversation_not_found');
	}

	/**
	 * Marca atividade: sobe a conversa na lista, liga a marca de voz e, na
	 * primeira pergunta, troca o título automático por ela.
	 */
	async touch(
		userId: string,
		id: string,
		input: { voice?: boolean; question?: string }
	): Promise<void> {
		const set: Record<string, unknown> = { lastMessageAt: new Date() };
		if (input.voice) set.hasVoice = true;
		await this.conversations
			.updateOne({ _id: this.objectId(id), userId }, { $set: set })
			.exec();
		if (input.question) {
			await this.conversations
				.updateOne(
					{ _id: this.objectId(id), userId, autoTitle: true },
					{
						$set: {
							title: titleFromQuestion(input.question),
							autoTitle: false,
						},
					}
				)
				.exec();
		}
	}

	/**
	 * Migração preguiçosa e idempotente: mensagens de antes das conversas
	 * (sem `conversationId`) viram uma conversa "Conversas anteriores" na
	 * primeira vez que a lista é pedida. Rodar de novo não acha nada a mover.
	 */
	private async adoptLegacyMessages(userId: string): Promise<void> {
		const legacy = await this.messages
			.findOne({ userId, conversationId: { $exists: false } })
			.sort({ createdAt: -1 })
			.lean()
			.exec();
		if (!legacy) return;
		const conversation = await this.conversations.create({
			userId,
			title: LEGACY_CONVERSATION_TITLE,
			autoTitle: false,
			lastMessageAt: legacy.createdAt ?? new Date(),
			hasVoice: Boolean(
				await this.messages
					.exists({
						userId,
						conversationId: { $exists: false },
						channel: 'voice',
					})
					.exec()
			),
		});
		await this.messages
			.updateMany(
				{ userId, conversationId: { $exists: false } },
				{ $set: { conversationId: String(conversation._id) } }
			)
			.exec();
	}

	private objectId(id: string): Types.ObjectId {
		if (!Types.ObjectId.isValid(id)) {
			throw new NotFoundException('conversation_not_found');
		}
		return new Types.ObjectId(id);
	}
}

function toView(doc: any): ChatConversationView {
	return {
		id: String(doc._id),
		title: doc.title,
		hasVoice: Boolean(doc.hasVoice),
		createdAt: doc.createdAt,
		lastMessageAt: doc.lastMessageAt,
	};
}
