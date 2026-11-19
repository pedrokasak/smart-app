import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChatConversationDocument = ChatConversation & Document;

/**
 * Conversa do Chat Inteligente (ADR-007, fase 2). Cada uma guarda o próprio
 * histórico e o próprio contexto. `userId` vem do JWT, nunca do corpo.
 */
@Schema()
export class ChatConversation {
	@Prop({ required: true, index: true })
	userId: string;

	@Prop({ required: true, maxlength: 120 })
	title: string;

	/** Teve pergunta por voz: a lista mostra a marca "Por voz". */
	@Prop({ default: false })
	hasVoice: boolean;

	/** O título ainda é o automático e pode virar a primeira pergunta. */
	@Prop({ default: true })
	autoTitle: boolean;

	@Prop({ default: Date.now })
	createdAt: Date;

	@Prop({ default: Date.now, index: true })
	lastMessageAt: Date;
}

export const ChatConversationSchema =
	SchemaFactory.createForClass(ChatConversation);
ChatConversationSchema.index({ userId: 1, lastMessageAt: -1 });
