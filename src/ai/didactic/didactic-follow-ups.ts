import type { ChatOrchestratorIntent } from 'src/ai/orchestration/chat-orchestrator.types';

/**
 * Perguntas "Para entender mais" do Copiloto didático. Só entram perguntas
 * que o roteador determinístico já leva à intenção certa — conferido em
 * `chat-routing-eval.spec.ts` —, para o clique nunca cair numa resposta
 * vazia nem gastar LLM.
 */
export const FOLLOW_UPS = {
	risk: {
		question: 'Qual o risco da minha carteira?',
		intent: 'portfolio_risk',
	},
	allocationGap: {
		question: 'Onde minha carteira está fora da meta?',
		intent: 'allocation_gap',
	},
	checklist: {
		question: 'O que preciso fazer na minha carteira agora?',
		intent: 'action_checklist',
	},
	dividends: {
		question: 'Quanto recebi de proventos nos últimos 12 meses?',
		intent: 'dividends_received',
	},
	correlation: {
		question: 'Qual a correlação entre os meus ativos?',
		intent: 'correlation_matrix',
	},
	attribution: {
		question: 'Quanto cada ativo contribuiu para o retorno da carteira?',
		intent: 'return_attribution',
	},
	summary: {
		question: 'Resumo da minha carteira',
		intent: 'portfolio_summary',
	},
} as const satisfies Record<
	string,
	{ question: string; intent: ChatOrchestratorIntent }
>;

/** Pergunta de imposto para um ativo da carteira. */
export const taxFollowUp = (symbol: string) => ({
	question: `Quanto de imposto eu pagaria sobre o lucro de ${symbol}?`,
	intent: 'tax_estimation' as const,
});

/** Pergunta de aporte com um valor de exemplo. */
export const contributionFollowUp = (amountLabel: string) => ({
	question: `Simular aporte de ${amountLabel}`,
	intent: 'contribution_simulation' as const,
});
