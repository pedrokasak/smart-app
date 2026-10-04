import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import {
	ChatMessage,
	ChatMessageDocument,
} from 'src/ai/chat-history/schema/chat-message.schema';
import {
	AiEvalChatSample,
	AiEvalSampleSource,
} from 'src/ai/evaluation/application/ai-eval-sample-source.port';

interface SampledAnswer {
	_id: Types.ObjectId;
	userId: string;
	createdAt: Date;
	text: string;
	payload?: { intent?: unknown; routing?: { mode?: unknown } };
}

/**
 * Amostra do histórico do Chat Inteligente (TRA-242): respostas ok da
 * janela, com a pergunta do mesmo usuário que veio logo antes. O `userId`
 * só serve para achar a pergunta; o id que sai é um hash da mensagem.
 */
@Injectable()
export class MongoChatEvalSampleSource implements AiEvalSampleSource {
	constructor(
		@InjectModel(ChatMessage.name)
		private readonly model: Model<ChatMessageDocument>
	) {}

	async sampleChatAnswers(
		since: Date,
		limit: number
	): Promise<AiEvalChatSample[]> {
		if (limit <= 0) return [];
		const answers = await this.model
			.aggregate<SampledAnswer>([
				{
					$match: {
						role: 'assistant',
						status: 'ok',
						createdAt: { $gte: since },
						'payload.intent': { $exists: true, $nin: ['unknown', null] },
					},
				},
				{ $sample: { size: limit } },
				{
					$project: {
						userId: 1,
						createdAt: 1,
						text: 1,
						'payload.intent': 1,
						'payload.routing.mode': 1,
					},
				},
			])
			.exec();

		const samples: AiEvalChatSample[] = [];
		for (const answer of answers) {
			const question = await this.model
				.findOne({
					userId: answer.userId,
					role: 'user',
					createdAt: { $lte: answer.createdAt },
				})
				.sort({ createdAt: -1 })
				.select('text')
				.lean<{ text?: string } | null>()
				.exec();
			const text = String(question?.text ?? '').trim();
			if (!text || !String(answer.text ?? '').trim()) continue;
			samples.push({
				id: createHash('sha256')
					.update(String(answer._id))
					.digest('hex')
					.slice(0, 16),
				intent: String(answer.payload?.intent ?? 'unknown'),
				routingMode:
					answer.payload?.routing?.mode === 'tool_calling'
						? 'tool_calling'
						: 'regex',
				question: text,
				answer: answer.text,
			});
		}
		return samples;
	}
}
