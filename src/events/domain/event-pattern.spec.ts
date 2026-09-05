import { matchesEventPattern } from './event-pattern';

describe('matchesEventPattern', () => {
	it.each([
		['portfolio.dividend.received', 'portfolio.dividend.received', true],
		['portfolio.dividend.received', 'portfolio.dividend.paid', false],
		['portfolio.*.received', 'portfolio.dividend.received', true],
		['portfolio.*.received', 'portfolio.allocation.breached', false],
		['portfolio.*', 'portfolio.dividend.received', false],
		['portfolio.**', 'portfolio.dividend.received', true],
		['portfolio.**', 'portfolio.allocation.breached', true],
		['portfolio.**', 'market.quote.stale', false],
		['**', 'qualquer.coisa.aqui', true],
		['**', 'subscription.expiring', true],
		['subscription.expiring', 'subscription.expiring', true],
		['subscription.expiring', 'subscription.expiring.soon', false],
		['ai.insight.high_priority', 'ai.insight.high_priority', true],
	])('padrao %s vs tipo %s -> %s', (padrao, tipo, esperado) => {
		expect(matchesEventPattern(padrao, tipo)).toBe(esperado);
	});

	it('`portfolio.**` exige ao menos um nivel a mais', () => {
		expect(matchesEventPattern('portfolio.**', 'portfolio')).toBe(false);
	});

	it('padrao mais longo que o tipo nao casa', () => {
		expect(
			matchesEventPattern(
				'portfolio.dividend.received.late',
				'portfolio.dividend.received'
			)
		).toBe(false);
	});

	it('casa a mesma semantica que o EventEmitter2 usa no bus in-process', () => {
		// O worker roteia com esta funcao e o bus in-process roteia com o
		// EventEmitter2. Se as duas divergirem, "quem escuta o que" muda ao
		// trocar de transporte — exatamente o que a TRA-136 evita.
		const tipos = [
			'portfolio.dividend.received',
			'portfolio.allocation.breached',
			'ai.insight.high_priority',
			'market.quote.stale',
			'subscription.expiring',
		];
		expect(tipos.filter((t) => matchesEventPattern('**', t))).toHaveLength(5);
		expect(tipos.filter((t) => matchesEventPattern('portfolio.**', t))).toEqual(
			['portfolio.dividend.received', 'portfolio.allocation.breached']
		);
	});
});
