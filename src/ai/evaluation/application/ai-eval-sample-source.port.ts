/** Uma resposta do chat com a pergunta que a originou (TRA-242). */
export interface AiEvalChatSample {
	/** Opaco: não identifica usuário nem mensagem fora daqui. */
	id: string;
	intent: string;
	routingMode: 'regex' | 'tool_calling';
	question: string;
	answer: string;
}

/**
 * De onde vêm as respostas do chat avaliadas na semana: o histórico do
 * Chat Inteligente, que guarda intenção e rota de cada resposta.
 */
export interface AiEvalSampleSource {
	sampleChatAnswers(since: Date, limit: number): Promise<AiEvalChatSample[]>;
}

export const AI_EVAL_SAMPLE_SOURCE = Symbol('AI_EVAL_SAMPLE_SOURCE');
