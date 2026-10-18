import type { TradeHistoryQuery } from 'src/ai/orchestration/trade-history/trade-history.query';
import type { TradeRow } from 'src/ai/orchestration/trade-history/trade-history.summary';

export const CHAT_TRADE_HISTORY = Symbol('CHAT_TRADE_HISTORY');

/** Teto de linhas lidas por consulta: o resumo não precisa de mais que isto. */
export const MAX_TRADES_READ = 2000;

/**
 * Operações do usuário para o chat (ADR-002, TRA-16, fase 2). O `userId`
 * vem do token, via orquestrador, nunca da pergunta: não há como pedir a
 * operação de outra pessoa.
 */
export interface ChatTradeHistoryPort {
	listTrades(userId: string, query: TradeHistoryQuery): Promise<TradeRow[]>;
}
