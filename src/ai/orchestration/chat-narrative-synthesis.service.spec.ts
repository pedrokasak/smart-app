import { ChatNarrativeSynthesisService } from 'src/ai/orchestration/chat-narrative-synthesis.service';
import { ChatOrchestratorService } from 'src/ai/orchestration/chat-orchestrator.service';
import { ChatNarrativeSynthesizerPort } from 'src/ai/orchestration/chat-narrative-synthesizer.port';

describe('ChatNarrativeSynthesisService', () => {
	const baseComparisonOrchestration = {
		intent: 'asset_comparison',
		deterministic: true,
		route: {
			type: 'deterministic_no_llm',
			llmEligible: false,
			reason: 'rules_resolved',
		},
		cache: {
			key: null,
			hit: false,
			ttlSeconds: null,
		},
		cost: {
			llmCalls: 0,
			tokenUsageEstimate: 0,
			estimatedLlmCallsAvoidedByCache: 0,
		},
		question: 'Compare BBAS3 e ITUB4',
		context: {
			mentionedSymbols: ['BBAS3', 'ITUB4'],
			ownedSymbols: ['ITUB4'],
			externalSymbols: ['BBAS3'],
			positionsCount: 2,
		},
		data: {
			comparison: {
				executiveSummary: {
					bestDividendSymbol: 'BBAS3',
				},
				results: [],
				unavailableSymbols: [],
			},
		},
		unavailable: [],
		warnings: [],
		assumptions: [],
	} as any;

	it('keeps comparison on deterministic path without LLM by default', async () => {
		const orchestrator = {
			orchestrate: jest.fn().mockResolvedValue(baseComparisonOrchestration),
		} as unknown as ChatOrchestratorService;
		const synthesizer = {
			synthesize: jest.fn(),
		} as unknown as ChatNarrativeSynthesizerPort;

		const service = new ChatNarrativeSynthesisService(
			orchestrator,
			synthesizer
		);
		const response = await service.respond('user-1', 'Compare BBAS3 e ITUB4');

		expect(response.narrative.mode).toBe('deterministic_fallback');
		expect(response.narrative.text).toContain(
			'Comparação estruturada concluída'
		);
		expect(synthesizer.synthesize).not.toHaveBeenCalled();
	});

	it('allows optional synthesis layer for deterministic comparison output', async () => {
		const orchestrator = {
			orchestrate: jest.fn().mockResolvedValue(baseComparisonOrchestration),
		} as unknown as ChatOrchestratorService;
		const synthesizer = {
			synthesize: jest.fn().mockResolvedValue({
				text: 'BBAS3 tem melhor dividend yield; ITUB4 mostra melhor encaixe histórico.',
				metadata: { model: 'test-model' },
			}),
		} as unknown as ChatNarrativeSynthesizerPort;

		const service = new ChatNarrativeSynthesisService(
			orchestrator,
			synthesizer
		);
		const response = await service.respond('user-1', 'Compare BBAS3 e ITUB4', {
			enableNarrativeForDeterministic: true,
		});

		expect(response.narrative.mode).toBe('llm_synthesized');
		expect(response.narrative.text).toContain(
			'BBAS3 tem melhor dividend yield'
		);
		expect(synthesizer.synthesize).toHaveBeenCalledTimes(1);
	});

	it('falls back safely when llm synthesis fails', async () => {
		const synthesisRequiredOrchestration = {
			...baseComparisonOrchestration,
			intent: 'narrative_synthesis',
			route: {
				type: 'synthesis_required',
				llmEligible: true,
				reason: 'narrative_requested',
			},
			question: 'Explique com detalhes minha estratégia',
		} as any;
		const orchestrator = {
			orchestrate: jest.fn().mockResolvedValue(synthesisRequiredOrchestration),
		} as unknown as ChatOrchestratorService;
		const synthesizer = {
			synthesize: jest.fn().mockRejectedValue(new Error('llm down')),
		} as unknown as ChatNarrativeSynthesizerPort;

		const service = new ChatNarrativeSynthesisService(
			orchestrator,
			synthesizer
		);
		const response = await service.respond(
			'user-1',
			'Explique com detalhes minha estratégia'
		);

		expect(response.narrative.mode).toBe('deterministic_fallback');
		expect(response.orchestration.warnings).toEqual(
			expect.arrayContaining(['narrative_synthesis_failed'])
		);
	});

	it('threads the userId into the synthesizer input (RAG isolation, TRA-76)', async () => {
		// A propriedade de seguranca do RAG e o filtro por usuario. Se o userId
		// nao chegar no synthesizer, o adapter nao tem como escopar o retrieval.
		// Este teste existe pra isso quebrar se alguem parar de passar o userId.
		const synthesisRequiredOrchestration = {
			...baseComparisonOrchestration,
			intent: 'narrative_synthesis',
			route: {
				type: 'synthesis_required',
				llmEligible: true,
				reason: 'narrative_requested',
			},
		};
		const orchestrator = {
			orchestrate: jest.fn().mockResolvedValue(synthesisRequiredOrchestration),
		} as unknown as ChatOrchestratorService;
		const synthesizer = {
			synthesize: jest.fn().mockResolvedValue({ text: 'narrativa' }),
		} as unknown as ChatNarrativeSynthesizerPort;

		const service = new ChatNarrativeSynthesisService(
			orchestrator,
			synthesizer
		);
		await service.respond('user-42', 'Analise minha carteira');

		expect(synthesizer.synthesize).toHaveBeenCalledTimes(1);
		const input = (synthesizer.synthesize as jest.Mock).mock.calls[0][0];
		expect(input.userId).toBe('user-42');
	});
});
