import {
	buildAnswerSources,
	computeAnswerConfidence,
} from './answer-confidence';

describe('computeAnswerConfidence', () => {
	it('cálculo determinístico sem lacuna tem confiança alta', () => {
		expect(
			computeAnswerConfidence({
				routeType: 'deterministic_no_llm',
				routeReason: 'rules_resolved',
				unavailable: [],
				assumptions: [],
			})
		).toEqual({ score: 0.95, basis: 'deterministic' });
	});

	// Cada lacuna declarada desconta: a conta é exata, a cobertura não.
	it('desconta dado indisponível e premissa assumida', () => {
		const result = computeAnswerConfidence({
			routeType: 'deterministic_no_llm',
			routeReason: 'rules_resolved',
			unavailable: ['target_allocation_missing'],
			assumptions: ['dividends_estimated_from_current_quantity'],
		});

		expect(result.score).toBe(0.8);
	});

	it('dado insuficiente parte de patamar baixo e nunca passa do piso', () => {
		const result = computeAnswerConfidence({
			routeType: 'deterministic_no_llm',
			routeReason: 'insufficient_structured_data',
			unavailable: ['a', 'b', 'c', 'd'],
			assumptions: ['x', 'y', 'z', 'w'],
		});

		expect(result.score).toBe(0.3);
	});

	it('recusa honesta não tem confiança', () => {
		expect(
			computeAnswerConfidence({
				routeType: 'deterministic_no_llm',
				routeReason: 'capability_not_available',
				unavailable: ['quant_analysis_not_available'],
				assumptions: [],
			})
		).toEqual({ score: null, basis: 'refusal' });
	});

	it('RAG com trechos sobe com o apoio, até 90%', () => {
		const withTwo = computeAnswerConfidence({
			routeType: 'synthesis_required',
			routeReason: 'narrative_requested',
			unavailable: [],
			assumptions: [],
			narrativeMode: 'llm_synthesized',
			ragChunkCount: 2,
		});
		const withMany = computeAnswerConfidence({
			routeType: 'synthesis_required',
			routeReason: 'narrative_requested',
			unavailable: [],
			assumptions: [],
			narrativeMode: 'llm_synthesized',
			ragChunkCount: 20,
		});

		expect(withTwo).toEqual({ score: 0.7, basis: 'rag' });
		expect(withMany.score).toBe(0.9);
	});

	// Sem contexto do usuário, o texto é genérico — confiança baixa e dita.
	it('fallback genérico tem confiança baixa', () => {
		expect(
			computeAnswerConfidence({
				routeType: 'synthesis_required',
				routeReason: 'narrative_requested',
				unavailable: [],
				assumptions: [],
				narrativeMode: 'deterministic_fallback',
				ragChunkCount: 0,
			})
		).toEqual({ score: 0.4, basis: 'fallback' });
	});
});

describe('buildAnswerSources', () => {
	it('usa os rótulos do handoff conforme o que a resposta usou', () => {
		expect(
			buildAnswerSources({
				intent: 'allocation_gap',
				positionsCount: 3,
				data: { rebalancing: { hasTarget: true } },
			})
		).toEqual(['Posições consolidadas', 'Política de investimento']);

		expect(
			buildAnswerSources({
				intent: 'correlation_matrix',
				positionsCount: 3,
				data: {},
			})
		).toEqual(['Posições consolidadas', 'Séries de preço 252d']);
	});

	it('não cita política sem meta configurada', () => {
		expect(
			buildAnswerSources({
				intent: 'allocation_gap',
				positionsCount: 3,
				data: { rebalancing: { hasTarget: false } },
			})
		).toEqual(['Posições consolidadas']);
	});

	it('cita os trechos do RAG quando houve', () => {
		expect(
			buildAnswerSources({
				intent: 'narrative_synthesis',
				positionsCount: 2,
				data: {},
				ragChunkCount: 3,
			})
		).toEqual(['Posições consolidadas', 'Seu histórico · 3 trechos']);
	});

	it('recusa não cita a carteira', () => {
		expect(
			buildAnswerSources({
				intent: 'unsupported_quant_analysis',
				positionsCount: 2,
				data: {},
			})
		).toEqual([]);
	});
});
