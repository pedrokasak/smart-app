import {
	hasMultipleRequests,
	isSmallTalk,
	toolRoutingTrigger,
} from 'src/ai/orchestration/tool-routing/chat-tool-routing.policy';

describe('toolRoutingTrigger (TRA-241)', () => {
	it('routes what the regex could not classify', () => {
		expect(
			toolRoutingTrigger('Estou exposto demais a bancos?', 'unknown')
		).toBe('unknown');
	});

	it.each(['oi', 'Oi, tudo bem?', 'bom dia!', 'obrigado', 'valeu'])(
		'never pays LLM for small talk: %p',
		(question) => {
			expect(isSmallTalk(question)).toBe(true);
			expect(toolRoutingTrigger(question, 'unknown')).toBeNull();
		}
	);

	it.each([
		['Compare PETR4 e VALE3 e diga o impacto no meu risco', 'asset_comparison'],
		[
			'Quanto recebi de dividendos e qual o risco da carteira?',
			'dividends_received',
		],
		['Simule a venda de ITUB4; também quero ver o imposto', 'sell_simulation'],
	] as const)('detects two requests in %p', (question, intent) => {
		expect(hasMultipleRequests(question)).toBe(true);
		expect(toolRoutingTrigger(question, intent)).toBe('multi_intent');
	});

	// Duas famílias sem ligação são UM pedido: o regex já acerta esses.
	it.each([
		'O que a PETR4 disse sobre dividendos no último ITR?',
		'Quanto vou pagar de imposto se vender?',
		'Compare ITUB4 e BBDC4',
		'Minha carteira está ganhando do CDI?',
		'Qual o risco da minha carteira?',
	])('keeps a single request on the regex: %p', (question) => {
		expect(hasMultipleRequests(question)).toBe(false);
	});

	it('leaves honest refusals and strategy questions alone', () => {
		const question = 'Qual o VaR por fator e também o carry?';
		expect(
			toolRoutingTrigger(question, 'unsupported_quant_analysis')
		).toBeNull();
		expect(toolRoutingTrigger(question, 'narrative_synthesis')).toBeNull();
		expect(toolRoutingTrigger(question, 'market_screening')).toBeNull();
	});
});
