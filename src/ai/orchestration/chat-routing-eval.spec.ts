/**
 * Suíte de avaliação de roteamento do chat (TRA-75).
 *
 * Diferente de `chat-orchestrator.service.spec.ts`, que testa cada handler
 * isoladamente, esta suíte é de CARACTERIZAÇÃO: fixa o comportamento de
 * roteamento observável hoje, pergunta a pergunta.
 *
 * Serve de rede de segurança pra três mudanças planejadas que mexem
 * exatamente aqui:
 *  - TRA-73 (extrair handlers de intent pra strategies) — comportamento
 *    tem que sair idêntico do outro lado do refactor;
 *  - TRA-76 (plugar RAG como intent nova) — a intent nova entra numa
 *    cadeia de regex onde ORDEM é regra de negócio implícita, e é preciso
 *    provar que nenhuma das 17 existentes foi roubada;
 *  - TRA-79 (resolveUserPlan vindo da assinatura).
 *
 * Convenção: cada caso declara a intent esperada. Quando o caso existe
 * por causa de uma fronteira entre duas regex que competem, o motivo vai
 * escrito no campo `why` — é o que impede alguém "consertar" uma regex e
 * quebrar a outra sem perceber.
 */

import { ChatOrchestratorService } from 'src/ai/orchestration/chat-orchestrator.service';
import { ChatOrchestratorIntent } from 'src/ai/orchestration/chat-orchestrator.types';
import { ChatCostObserverPort } from 'src/ai/orchestration/chat-cost-observer.port';
import { ChatResponseCachePort } from 'src/ai/orchestration/chat-response-cache.port';
import { UnifiedIntelligenceFacade } from 'src/intelligence/application/unified-intelligence.facade';
import { MarketDataProviderPort } from 'src/market-data/application/market-data-provider.port';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { RiDocumentSummaryService } from 'src/ri-intelligence/application/ri-document-summary.service';
import { RiDocumentQueryPort } from 'src/ri-intelligence/application/ri-document-query.port';
import { StockService } from 'src/stocks/stocks.service';
import {
	PRO_ACCESS_LEVEL,
	UserPlanResolverPort,
} from 'src/subscription/application/user-plan.types';
import { ChatToolRouterService } from 'src/ai/orchestration/tool-routing/chat-tool-router.service';

interface RoutingCase {
	question: string;
	expectedIntent: ChatOrchestratorIntent;
	/** Presente só quando o caso existe por causa de fronteira entre regex. */
	why?: string;
}

const ROUTING_CASES: RoutingCase[] = [
	// --- Resumo de carteira -------------------------------------------------
	{ question: 'Resumo da minha carteira', expectedIntent: 'portfolio_summary' },
	{ question: 'Quanto tenho investido?', expectedIntent: 'portfolio_summary' },
	{
		question: 'Qual meu patrimônio hoje?',
		expectedIntent: 'portfolio_summary',
	},
	{
		question: 'Me explica minha carteira',
		expectedIntent: 'portfolio_summary',
		why:
			'"explica" sozinho cairia em narrative_synthesis (LLM). A lista de ' +
			'exceção com "minha carteira" mantém a pergunta no caminho ' +
			'determinístico, com números reais. Regressão aqui troca resposta ' +
			'exata por prosa genérica — e ainda paga LLM pra isso.',
	},

	// --- Risco / concentração ----------------------------------------------
	{
		question: 'Minha carteira está concentrada?',
		expectedIntent: 'portfolio_risk',
	},
	{
		question: 'Qual o risco da minha carteira?',
		expectedIntent: 'portfolio_risk',
	},
	{
		question: 'Por que você considera minha carteira concentrada?',
		expectedIntent: 'portfolio_risk',
		why:
			'Caso-chave pra TRA-76. "por que" sugere narrativa, mas "minha ' +
			'carteira" está na lista de exceção e "concentrada" casa com a regex ' +
			'de risco antes. Quando o RAG virar intent, esta pergunta é candidata ' +
			'natural a ser roubada — este teste é o alarme.',
	},

	// --- Narrativa (LLM esperado) ------------------------------------------
	{
		question: 'Qual a estratégia ideal pra mim?',
		expectedIntent: 'narrative_synthesis',
	},
	{
		question: 'Por que ações pagam dividendos diferentes?',
		expectedIntent: 'narrative_synthesis',
		why:
			'"por que" sem referência à carteira do usuário: não há dado ' +
			'estruturado que responda, então narrativa é a rota certa.',
	},

	// --- Fiscal -------------------------------------------------------------
	{
		question: 'Quanto vou pagar de imposto se vender?',
		expectedIntent: 'sell_simulation',
		why:
			'Parece caso de tax_estimation pelo texto, mas sell_simulation é a ' +
			'rota certa e vem antes na cadeia de propósito: não dá pra dizer o ' +
			'imposto de uma venda sem simular a venda. `simulateSell` delega pra ' +
			'`taxEngineService.simulateSaleImpact`, então o imposto sai na ' +
			'resposta do mesmo jeito. tax_estimation atende a pergunta fiscal ' +
			'sem venda hipotética (prejuízo acumulado, por exemplo).',
	},
	{
		question: 'Tenho prejuízo acumulado pra compensar?',
		expectedIntent: 'tax_estimation',
	},

	// --- Venda --------------------------------------------------------------
	{
		question: 'Simular venda de ITUB4',
		expectedIntent: 'sell_simulation',
	},

	// --- Dividendos ---------------------------------------------------------
	{
		question: 'Quanto vou receber de dividendos?',
		expectedIntent: 'dividend_projection',
	},

	// --- Benchmark ----------------------------------------------------------
	{
		question: 'Minha carteira está ganhando do CDI?',
		expectedIntent: 'benchmark_simple',
		why:
			'"carteira" casaria com portfolio_summary, mas "cdi" vem antes na ' +
			'cadeia. Comparação com benchmark é a intenção real.',
	},

	// --- Comparação de ativos ----------------------------------------------
	{
		question: 'Compare ITUB4 e BBDC4',
		expectedIntent: 'asset_comparison',
	},

	// --- Oportunidades ------------------------------------------------------
	{
		question: 'Tem alguma oportunidade na minha carteira?',
		expectedIntent: 'opportunity_radar',
		why: '"carteira" está presente, mas "oportunidade" vem antes na cadeia.',
	},

	// --- Cenário futuro -----------------------------------------------------
	{
		question: 'Quanto minha carteira pode valer em 10 anos?',
		expectedIntent: 'future_scenario',
	},

	// --- Comitê de investimento --------------------------------------------
	{
		question: 'Quero o comitê de investimento',
		expectedIntent: 'investment_committee',
	},

	// --- RI -----------------------------------------------------------------
	{
		question: 'Resumo de RI da PETR4',
		expectedIntent: 'ri_summary',
		why:
			'"resumo" casaria com portfolio_summary, mas a regex de RI vem antes ' +
			'na cadeia.',
	},
	{
		question: 'O que a PETR4 disse sobre dividendos no último ITR?',
		expectedIntent: 'ri_question',
		why:
			'TRA-264: pergunta sobre o que a empresa divulgou responde pelo ' +
			'acervo de documentos, citando página. Sem a regra, "dividendos" ' +
			'levava a outra intent, sem documento nenhum.',
	},
	{
		question: 'O que o fato relevante da VALE3 fala sobre a barragem?',
		expectedIntent: 'ri_question',
	},
	{
		question: 'Explique o que a PETR4 informou sobre a dívida',
		expectedIntent: 'ri_question',
		why:
			'"explique" levaria a narrative_synthesis (LLM genérico). O que a ' +
			'empresa informou tem resposta nos documentos, com citação.',
	},
	{
		question: 'O que mudou no último RI de BBDC4?',
		expectedIntent: 'ri_summary',
		why:
			'TRA-264: sem assunto nem verbo de divulgação, continua pedido de ' +
			'resumo — a regra da pergunta ao acervo não pode roubar o resumo.',
	},

	// --- Encaixe na carteira ------------------------------------------------
	{
		question: 'BBAS3 faz sentido pra mim?',
		expectedIntent: 'portfolio_fit_analysis',
	},

	// --- Sem intenção reconhecível -----------------------------------------
	{
		question: 'oi tudo bem?',
		expectedIntent: 'unknown',
		why:
			'Pergunta sem intenção de negócio não pode cair numa intent cara por ' +
			'acidente. "unknown" é resultado correto, não falha de classificação.',
	},
];

/**
 * Perguntas que hoje resolvem sem nenhuma chamada de LLM. Manter esta lista
 * verde é asserção de custo, não detalhe de implementação: é o que garante
 * que o roteamento determinístico continua pagando por si.
 */
const NO_LLM_CASES = [
	'Resumo da minha carteira',
	'Qual o risco da minha carteira?',
	'Quanto tenho investido?',
];

describe('Chat routing eval (TRA-75)', () => {
	const mockPortfolioService = {
		getUserPortfolios: jest.fn(),
	} as unknown as PortfolioService;

	const mockUnifiedFacade = {
		getPortfolioSummary: jest.fn(),
		getPortfolioRiskAnalysis: jest.fn(),
		analyzeAssetFit: jest.fn(),
		compareAssets: jest.fn(),
		simulateSell: jest.fn(),
		detectOpportunities: jest.fn(),
		simulateFuture: jest.fn(),
		getTrackerrScore: jest.fn(),
	} as unknown as UnifiedIntelligenceFacade;

	const mockMarketDataProvider: MarketDataProviderPort = {
		getAssetSnapshot: jest.fn(),
		getDailyCloses: jest.fn().mockResolvedValue([]),
		getManyAssetSnapshots: jest.fn(),
	};

	const mockResponseCache: ChatResponseCachePort<any> = {
		get: jest.fn().mockResolvedValue(null),
		set: jest.fn().mockResolvedValue(undefined),
	};

	const mockCostObserver: ChatCostObserverPort = {
		record: jest.fn(),
	};

	const mockRiDocumentSummaryService = {
		summarize: jest.fn(),
	} as unknown as RiDocumentSummaryService;

	const mockRiDocumentQuery: RiDocumentQueryPort = {
		getLatestByTicker: jest.fn(),
		getPreviousComparable: jest.fn(),
	};

	const mockStockService = {
		getAllNational: jest.fn().mockResolvedValue({
			stocks: ['ITUB4', 'PETR4', 'BBAS3', 'BBDC4', 'XPLG11'].map((stock) => ({
				stock,
				name: stock,
			})),
		}),
	} as unknown as StockService;

	const mockUserPlanResolver = {
		resolve: jest.fn().mockResolvedValue('free'),
	} as unknown as UserPlanResolverPort;

	const makeService = () =>
		new ChatOrchestratorService(
			mockPortfolioService,
			mockUnifiedFacade,
			mockMarketDataProvider,
			mockResponseCache,
			mockCostObserver,
			mockRiDocumentSummaryService,
			mockStockService,
			mockUserPlanResolver,
			{
				// Composição mínima: as intenções de meta e proventos (TRA-141)
				// precisam dela para responder, inclusive pelo roteador (TRA-241).
				getComposition: jest.fn().mockResolvedValue({
					rebalancing: { hasTarget: false, buckets: [] },
					yield: {
						assets: [],
						estimatedAnnualIncome: 0,
						portfolioYieldOnMarket: 0,
						portfolioYieldOnCost: 0,
						approximated: false,
					},
					unavailable: [],
				}),
			} as unknown as ConstructorParameters<typeof ChatOrchestratorService>[8],
			// Roteamento nao le PDF: resolver sem texto (TRA-253).
			{
				resolve: jest.fn(async (document: unknown) => ({
					document,
					content: null,
					reason: 'not_cached',
					from: null,
				})),
			} as unknown as ConstructorParameters<typeof ChatOrchestratorService>[9],
			// Acervo de RI (TRA-264): roteamento nao consulta.
			{
				index: jest.fn(),
				ask: jest.fn().mockResolvedValue({ items: [], notFound: true }),
			} as unknown as ConstructorParameters<typeof ChatOrchestratorService>[10],
			mockRiDocumentQuery
		);

	beforeEach(() => {
		(mockPortfolioService.getUserPortfolios as jest.Mock).mockResolvedValue([
			{
				assets: [
					{
						symbol: 'ITUB4',
						type: 'stock',
						quantity: 10,
						total: 1000,
						price: 100,
						sector: 'Financial',
					},
					{
						symbol: 'XPLG11',
						type: 'fii',
						quantity: 5,
						total: 500,
						price: 100,
						sector: 'Logistics',
					},
				],
			},
		]);
		(mockUnifiedFacade.getPortfolioSummary as jest.Mock).mockReturnValue({
			totalValue: 1500,
			positionsCount: 2,
		});
		// Forma de UnifiedPortfolioRiskOutput (unified-intelligence.types.ts).
		(mockUnifiedFacade.getPortfolioRiskAnalysis as jest.Mock).mockReturnValue({
			risk: { flags: [], score: 42 },
			concentrationByAsset: [],
			concentrationBySector: [],
			rebalanceSuggestionInputs: [],
		});
		(mockUnifiedFacade.getTrackerrScore as jest.Mock).mockReturnValue({
			modelVersion: 'trackerr_score_v1',
			overall: 61,
			weights: {
				quality: 0.24,
				risk: 0.24,
				valuation: 0.2,
				fiscal: 0.16,
				portfolio_fit: 0.16,
			},
			pillars: [],
			explanation: { topPositiveDrivers: [], topNegativeDrivers: [] },
		});

		// Retornos mínimos só pra cada handler conseguir montar a resposta. O
		// que esta suíte afirma é a ROTA, não o conteúdo — o conteúdo de cada
		// handler é responsabilidade de chat-orchestrator.service.spec.ts.
		(mockUnifiedFacade.compareAssets as jest.Mock).mockResolvedValue({
			unavailableSymbols: [],
			warnings: [],
			comparison: [],
		});
		(mockUnifiedFacade.detectOpportunities as jest.Mock).mockResolvedValue({
			unavailableSymbols: [],
			warnings: [],
			opportunities: [],
			signals: [],
		});
		(mockUnifiedFacade.simulateFuture as jest.Mock).mockReturnValue({
			dividendProjection: { annualIncome: 0 },
			projectedValue: 0,
		});
		(mockUnifiedFacade.simulateSell as jest.Mock).mockReturnValue({
			grossProfit: 0,
			taxDue: 0,
			warnings: [],
		});
		(mockUnifiedFacade.analyzeAssetFit as jest.Mock).mockResolvedValue({
			fitScore: 0,
			warnings: [],
		});
		(
			mockMarketDataProvider.getManyAssetSnapshots as jest.Mock
		).mockResolvedValue([]);
		(mockMarketDataProvider.getAssetSnapshot as jest.Mock).mockResolvedValue(
			null
		);
		(mockRiDocumentQuery.getLatestByTicker as jest.Mock).mockResolvedValue(
			null
		);
		(mockRiDocumentQuery.getPreviousComparable as jest.Mock).mockResolvedValue(
			null
		);
	});

	afterEach(() => jest.clearAllMocks());

	describe('intent routing', () => {
		it.each(ROUTING_CASES)(
			'routes "$question" to $expectedIntent',
			async ({ question, expectedIntent }) => {
				const service = makeService();
				const response = await service.orchestrate('user-eval', question);

				expect(response.intent).toBe(expectedIntent);
			}
		);
	});

	describe('cost regression: deterministic questions must not call the LLM', () => {
		it.each(NO_LLM_CASES)(
			'resolves "%s" without an LLM call',
			async (question) => {
				const service = makeService();
				const response = await service.orchestrate('user-eval', question);

				expect(response.cost.llmCalls).toBe(0);
				expect(response.route.type).toBe('deterministic_no_llm');
			}
		);
	});

	describe('suite integrity', () => {
		it('covers every intent that has at least one routing case', () => {
			// Não exige cobertura de 100% das intents (algumas só são alcançáveis
			// via copilotFlow, não por texto), mas garante que a tabela não
			// silenciosamente encolheu.
			const covered = new Set(ROUTING_CASES.map((c) => c.expectedIntent));
			expect(covered.size).toBeGreaterThanOrEqual(13);
		});

		it('has no duplicate questions', () => {
			const questions = ROUTING_CASES.map((c) => c.question);
			expect(new Set(questions).size).toBe(questions.length);
		});
	});

	/**
	 * Roteador com tool-calling (TRA-241). O planner aqui é um gabarito: para
	 * cada pergunta, as ferramentas certas. O que a suíte mede é o caminho —
	 * pergunta que o regex não reconhece chega à intenção certa pelo
	 * roteador — e o custo: pergunta que o regex já resolve não chama o LLM.
	 * A taxa de acerto do LLM de verdade sobre o mesmo gabarito é a avaliação
	 * offline do trackerr-ia (TRA-242).
	 */
	describe('tool-calling router (TRA-241)', () => {
		interface ToolRoutingCase {
			question: string;
			expectedIntents: ChatOrchestratorIntent[];
			plan: { intent: ChatOrchestratorIntent; tickers: string[] }[];
		}

		// Perguntas reais que o regex manda para `unknown`.
		const TOOL_ROUTING_CASES: ToolRoutingCase[] = [
			{
				question: 'Estou muito exposto a bancos?',
				expectedIntents: ['portfolio_risk'],
				plan: [{ intent: 'portfolio_risk', tickers: [] }],
			},
			{
				question: 'Como estão meus investimentos?',
				expectedIntents: ['portfolio_summary'],
				plan: [{ intent: 'portfolio_summary', tickers: [] }],
			},
			{
				question: 'Meus FIIs pagaram bem no último ano?',
				expectedIntents: ['dividends_received'],
				plan: [{ intent: 'dividends_received', tickers: [] }],
			},
			{
				question: 'Quanto ganhei com cada ação neste ano?',
				expectedIntents: ['return_attribution'],
				plan: [{ intent: 'return_attribution', tickers: [] }],
			},
		];

		// O regex resolve uma parte; o roteador traz a outra.
		const MULTI_REQUEST_CASE: ToolRoutingCase = {
			question: 'Compare ITUB4 e BBDC4 e diga o impacto no meu risco',
			expectedIntents: ['asset_comparison', 'portfolio_risk'],
			plan: [
				{ intent: 'asset_comparison', tickers: ['ITUB4', 'BBDC4'] },
				{ intent: 'portfolio_risk', tickers: [] },
			],
		};

		const goldenPlans = new Map(
			[...TOOL_ROUTING_CASES, MULTI_REQUEST_CASE].map((c) => [
				c.question,
				c.plan,
			])
		);

		const makeRouter = (planner: { plan: jest.Mock }) =>
			new ChatToolRouterService(
				makeService(),
				planner,
				{
					resolve: jest.fn(),
					resolveWithCapabilities: jest.fn().mockResolvedValue({
						tier: PRO_ACCESS_LEVEL,
						capabilities: [],
						capabilitiesKnown: null,
					}),
				},
				{ record: jest.fn(), recordToolRouting: jest.fn() },
				{ enabled: true, maxCalls: 3 }
			);

		const goldenPlanner = () => ({
			plan: jest.fn(async ({ question }: { question: string }) => ({
				calls: goldenPlans.get(question) ?? [],
				provider: 'golden',
				inputTokens: 0,
				outputTokens: 0,
				reason: null,
			})),
		});

		it.each(TOOL_ROUTING_CASES)(
			'the regex alone leaves "$question" as unknown',
			async ({ question }) => {
				const response = await makeService().orchestrate('user-eval', question);

				expect(response.intent).toBe('unknown');
			}
		);

		it.each(TOOL_ROUTING_CASES)(
			'the router answers "$question" with $expectedIntents',
			async ({ question, expectedIntents }) => {
				const answer = await makeRouter(goldenPlanner()).answer(
					'user-eval',
					question
				);

				expect(answer.parts.map((part) => part.intent)).toEqual(
					expectedIntents
				);
				expect(answer.routing.mode).toBe('tool_calling');
			}
		);

		it('answers both parts of a question with two requests', async () => {
			const answer = await makeRouter(goldenPlanner()).answer(
				'user-eval',
				MULTI_REQUEST_CASE.question
			);

			expect(answer.parts.map((part) => part.intent)).toEqual(
				MULTI_REQUEST_CASE.expectedIntents
			);
		});

		// Aceite da TRA-241: a taxa de `unknown` cai de forma mensurável.
		it('lowers the unknown rate of the suite', async () => {
			const questions = [
				...ROUTING_CASES.map((c) => c.question),
				...TOOL_ROUTING_CASES.map((c) => c.question),
			];
			let unknownByRegex = 0;
			let unknownByRouter = 0;
			for (const question of questions) {
				const regex = await makeService().orchestrate('user-eval', question);
				if (regex.intent === 'unknown') unknownByRegex += 1;
				const routed = await makeRouter(goldenPlanner()).answer(
					'user-eval',
					question
				);
				if (routed.parts[0].intent === 'unknown') unknownByRouter += 1;
			}

			expect(unknownByRegex).toBe(TOOL_ROUTING_CASES.length + 1);
			// Sobra só a conversa sem intenção ("oi tudo bem?"), de propósito.
			expect(unknownByRouter).toBe(1);
		});

		// Aceite da TRA-241: o que o regex roteia mantém a rota e custo zero.
		it.each(ROUTING_CASES.filter((c) => c.expectedIntent !== 'unknown'))(
			'keeps "$question" on the regex, without calling the LLM',
			async ({ question, expectedIntent }) => {
				const planner = goldenPlanner();

				const answer = await makeRouter(planner).answer('user-eval', question);

				expect(planner.plan).not.toHaveBeenCalled();
				expect(answer.parts.map((part) => part.intent)).toEqual([
					expectedIntent,
				]);
			}
		);
	});
});
