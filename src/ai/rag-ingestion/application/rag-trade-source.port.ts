import type { Trade } from 'src/fiscal/domain/trade';

export const RAG_TRADE_SOURCE = Symbol('RAG_TRADE_SOURCE');

/**
 * Origem das operações do usuário para o resumo do RAG (ADR-002, TRA-16). O
 * `userId` vem sempre do agendador, nunca de entrada externa: a consulta é
 * por dono.
 */
export interface RagTradeSourcePort {
	listTrades(userId: string): Promise<Trade[]>;
}
