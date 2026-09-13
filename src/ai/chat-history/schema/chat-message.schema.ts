import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ChatMessageDocument = ChatMessage & Document;

/**
 * Um documento por mensagem do Chat Inteligente (TRA-66). `userId` vem do
 * JWT autenticado, nunca do corpo da requisição — evita que um usuário leia
 * ou grave histórico de outro. `clientId` é o id gerado no frontend
 * (ex.: `u-<timestamp>`) e serve só para o cliente reconciliar sua lista
 * local com o histórico persistido; não há garantia de unicidade global.
 */
@Schema()
export class ChatMessage {
	@Prop({ required: true, index: true })
	userId: string;

	@Prop({ required: true })
	clientId: string;

	@Prop({ required: true, enum: ['user', 'assistant'] })
	role: 'user' | 'assistant';

	@Prop({ required: true })
	text: string;

	@Prop({ enum: ['ok', 'error'] })
	status?: 'ok' | 'error';

	@Prop()
	retryQuestion?: string;

	@Prop({ type: Object })
	payload?: Record<string, unknown>;

	@Prop()
	aiGenerated?: boolean;

	@Prop({ default: Date.now, index: true })
	createdAt: Date;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
ChatMessageSchema.index({ userId: 1, createdAt: 1 });
