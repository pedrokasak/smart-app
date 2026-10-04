import { ChatOrchestratorIntent } from 'src/ai/orchestration/chat-orchestrator.types';

/**
 * Catálogo do roteador com tool-calling (TRA-241): as intenções
 * determinísticas do chat oferecidas ao LLM como ferramentas. O LLM só
 * escolhe a ferramenta e os tickers; quem calcula é o mesmo código que o
 * regex já usa. Valores (quantidade, preço, aporte, prazo) continuam saindo
 * da pergunta, pelo parser determinístico de cada intenção — o LLM nunca
 * preenche número.
 *
 * Fora de propósito:
 * - `investment_committee`: recomenda ativos; só por pedido explícito.
 * - `narrative_synthesis`, `unknown`: não são ferramenta, são o que o
 *   roteador evita.
 * - `market_screening`, `unsupported_quant_analysis`: são recusas honestas,
 *   e o regex já as reconhece.
 * - `external_asset_question`: não tem ramo próprio no orquestrador.
 */

export interface ChatTool {
	name: ChatOrchestratorIntent;
	description: string;
	/** Quantos tickers a ferramenta aceita (0: nenhum). */
	maxTickers: number;
}

export const CHAT_TOOL_CATALOG: readonly ChatTool[] = [
	{
		name: 'portfolio_summary',
		description:
			'Resumo da carteira do usuário: patrimônio, alocação por classe e lista de ativos.',
		maxTickers: 0,
	},
	{
		name: 'portfolio_risk',
		description:
			'Risco e concentração da carteira: score de risco, maiores concentrações e sugestão de rebalanceamento por perfil.',
		maxTickers: 0,
	},
	{
		name: 'dividend_projection',
		description: 'Projeção dos dividendos e proventos futuros da carteira.',
		maxTickers: 0,
	},
	{
		name: 'dividends_received',
		description:
			'Proventos que os ativos da carteira pagaram nos últimos 12 meses.',
		maxTickers: 0,
	},
	{
		name: 'benchmark_simple',
		description: 'Desempenho da carteira comparado ao CDI ou ao Ibovespa.',
		maxTickers: 0,
	},
	{
		name: 'asset_comparison',
		description:
			'Compara dois ou mais ativos (fundamentos e encaixe na carteira). Com um ticker só, compara com a maior posição da carteira.',
		maxTickers: 4,
	},
	{
		name: 'external_asset_analysis',
		description: 'Dados de mercado de um ativo: cotação e indicadores.',
		maxTickers: 1,
	},
	{
		name: 'portfolio_fit_analysis',
		description:
			'Se um ativo faz sentido para a carteira do usuário (encaixe).',
		maxTickers: 1,
	},
	{
		name: 'sell_simulation',
		description:
			'Simula a venda de um ativo da carteira: lucro e imposto. Quantidade e preço saem da pergunta.',
		maxTickers: 1,
	},
	{
		name: 'tax_estimation',
		description:
			'Imposto de renda sobre investimentos e prejuízo acumulado a compensar.',
		maxTickers: 1,
	},
	{
		name: 'opportunity_radar',
		description: 'Oportunidades na carteira: ativos em faixa atrativa.',
		maxTickers: 0,
	},
	{
		name: 'future_scenario',
		description: 'Projeção do valor futuro da carteira em alguns anos.',
		maxTickers: 0,
	},
	{
		name: 'ri_summary',
		description:
			'Resumo do documento de RI mais recente de uma empresa (release, fato relevante).',
		maxTickers: 1,
	},
	{
		name: 'ri_comparison',
		description:
			'Compara o documento de RI mais recente de uma empresa com o anterior.',
		maxTickers: 1,
	},
	{
		name: 'ri_question',
		description:
			'Responde o que uma empresa divulgou nos documentos de RI (fato relevante, release, ITR), citando documento e página.',
		maxTickers: 1,
	},
	{
		name: 'correlation_matrix',
		description: 'Correlação entre os ativos da carteira.',
		maxTickers: 0,
	},
	{
		name: 'return_attribution',
		description:
			'Quanto cada ativo contribuiu para o retorno da carteira nos últimos 12 meses.',
		maxTickers: 0,
	},
	{
		name: 'allocation_gap',
		description: 'Onde a carteira está fora da meta de alocação.',
		maxTickers: 0,
	},
	{
		name: 'contribution_simulation',
		description:
			'Como distribuir um aporte entre as classes para voltar à meta. O valor sai da pergunta.',
		maxTickers: 0,
	},
	{
		name: 'action_checklist',
		description: 'Pontos de atenção da carteira que pedem alguma ação.',
		maxTickers: 0,
	},
];

const BY_NAME = new Map<string, ChatTool>(
	CHAT_TOOL_CATALOG.map((tool) => [tool.name, tool])
);

export function chatToolByName(name: string): ChatTool | null {
	return BY_NAME.get(name) ?? null;
}

/** JSON schema dos argumentos, no formato que o trackerr-ia repassa ao LLM. */
export function chatToolParameters(tool: ChatTool): Record<string, unknown> {
	if (!tool.maxTickers) return { type: 'object', properties: {} };
	return {
		type: 'object',
		properties: {
			tickers: {
				type: 'array',
				description:
					'Tickers da B3 citados na pergunta (ex.: PETR4). Vazio se nenhum.',
				items: { type: 'string' },
				maxItems: tool.maxTickers,
			},
		},
	};
}
