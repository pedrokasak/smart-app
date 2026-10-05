import { scrubPii } from 'src/common/privacy/scrub-pii';

describe('scrubPii (TRA-242)', () => {
	it.each([
		['meu cpf é 123.456.789-09', '[CPF]'],
		['cpf 12345678909 cadastrado', '[CPF]'],
		['cnpj 12.345.678/0001-90', '[CNPJ]'],
		['me escreve em ana.silva+inv@gmail.com', '[EMAIL]'],
		['liga no (11) 98765-4321', '[TELEFONE]'],
		['cartão 4111 1111 1111 1111', '[CARTAO]'],
		['agência 1234 conta 56789-0', '[CONTA]'],
	])('scrubs %p', (raw, placeholder) => {
		expect(scrubPii(raw)).toContain(placeholder);
	});

	it('keeps amounts, percentages and tickers', () => {
		const text =
			'PETR4 vale R$ 14.200,00 (23,1% da carteira); recebi R$ 3.284,50 em 12 meses.';

		expect(scrubPii(text)).toBe(text);
	});
});
