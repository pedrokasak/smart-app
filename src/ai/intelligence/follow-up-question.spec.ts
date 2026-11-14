import { resolveFollowUpQuestion } from './follow-up-question';

describe('resolveFollowUpQuestion (ADR-007, fase 2)', () => {
	const previous = 'Quanto a PETR4 pagou de dividendos este ano?';

	it.each([
		['e a VALE3?', 'Quanto a VALE3 pagou de dividendos este ano?'],
		['E a vale3?', 'Quanto a VALE3 pagou de dividendos este ano?'],
		['e o ITUB4', 'Quanto a ITUB4 pagou de dividendos este ano?'],
		['e sobre HGLG11?', 'Quanto a HGLG11 pagou de dividendos este ano?'],
	])(
		'"%s" vira a pergunta anterior com o ticker novo',
		(question, expected) => {
			expect(resolveFollowUpQuestion(question, previous)).toBe(expected);
		}
	);

	it('troca vários tickers na ordem', () => {
		expect(
			resolveFollowUpQuestion('e BBAS3 e ITUB4?', 'Compara PETR4 com VALE3')
		).toBe('Compara BBAS3 com ITUB4');
	});

	it.each([
		['Quanto a VALE3 pagou?', 'pergunta completa'],
		['e quanto pago de imposto?', 'sem ticker'],
		[
			'e a VALE3? E se eu vender metade das cotas que tenho hoje, quanto pago?',
			'longa demais',
		],
	])('"%s" fica como veio (%s)', (question) => {
		expect(resolveFollowUpQuestion(question, previous)).toBe(question);
	});

	it('sem pergunta anterior, ou anterior sem ticker, fica como veio', () => {
		expect(resolveFollowUpQuestion('e a VALE3?', null)).toBe('e a VALE3?');
		expect(
			resolveFollowUpQuestion('e a VALE3?', 'Como está minha carteira?')
		).toBe('e a VALE3?');
	});
});
