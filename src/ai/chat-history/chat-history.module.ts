import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatHistoryService } from './chat-history.service';
import { ChatMessage, ChatMessageSchema } from './schema/chat-message.schema';
import {
	ChatConversation,
	ChatConversationSchema,
} from './schema/chat-conversation.schema';
import { ChatConversationService } from './chat-conversation.service';
import { ChatConversationsController } from './chat-conversations.controller';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: ChatMessage.name, schema: ChatMessageSchema },
			{ name: ChatConversation.name, schema: ChatConversationSchema },
		]),
	],
	controllers: [ChatConversationsController],
	providers: [ChatHistoryService, ChatConversationService],
	exports: [ChatHistoryService, ChatConversationService],
})
export class ChatHistoryModule {}
