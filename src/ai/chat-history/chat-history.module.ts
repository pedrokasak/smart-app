import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatHistoryService } from './chat-history.service';
import { ChatMessage, ChatMessageSchema } from './schema/chat-message.schema';

@Module({
	imports: [
		MongooseModule.forFeature([
			{ name: ChatMessage.name, schema: ChatMessageSchema },
		]),
	],
	providers: [ChatHistoryService],
	exports: [ChatHistoryService],
})
export class ChatHistoryModule {}
