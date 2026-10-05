import type { VerdictFacts } from './verdict-facts';
import { extractNumbers, validateVerdictText } from './verdict-validator';

const facts: VerdictFacts = {
	scenario: {
		principal: 10000,
		years: 3,
		cdiPct: 13.65,
		ipcaPct: 4.5,
		irRatePct: 15,
	},
	ranking: [
		{
			name: 'CDB 110% do CDI',
			kind: 'CDB',
			exempt: false,
			grossAnnualPct: 15.11,
			netAnnualPct: 13.1,
			realAnnualPct: 8.23,
			netFinal: 14465.62,
		},
		{
			name: 'LCI 95% do CDI',
			kind: 'LCI',
			exempt: true,
			grossAnnualPct: 12.93,
			netAnnualPct: 12.93,
			realAnnualPct: 8.06,
			netFinal: 14400.41,
		},
		{
			name: 'Tesouro IPCA+ 2035',
			kind: 'TESOURO',
			exempt: false,
			grossAnnualPct: 12.39,
			netAnnualPct: 10.7,
			realAnnualPct: 5.94,
			netFinal: 13566.99,
		},
	],
	points: [
		'Ponto de virada: IPCA a 6,06% ao ano; a isenção equivale a 108,69% do CDI.',
	],
};

const good =
	'Com CDI a 13,65% e IPCA a 4,50% ao ano, em 3 anos, o CDB 110% do CDI rende 8,23% reais ao ano, à frente da LCI 95% do CDI (8,06%) e do Tesouro IPCA+ 2035 (5,94%).';

describe('extractNumbers', () => {
	it('lê formatos brasileiros e com ponto decimal', () => {
		expect(extractNumbers('R$ 14.465,62 e 13,65% e 13.65 e 1.234 e 7')).toEqual(
			[14465.62, 13.65, 13.65, 1234, 7]
		);
	});
});

describe('validateVerdictText', () => {
	it('aceita texto que só cita números e nomes dos fatos', () => {
		expect(validateVerdictText(good, facts)).toEqual({ valid: true });
	});

	it('aceita arredondamento pequeno (12,8% para 12,77%) e números dos pontos', () => {
		const rounded =
			'O CDB 110% do CDI lidera com 8,2% reais; a isenção da LCI equivale a 108,69% do CDI e o empate está em 6,06%.';
		expect(validateVerdictText(rounded, facts)).toEqual({ valid: true });
	});

	it('aceita valor final em reais com milhar', () => {
		const text = 'O CDB 110% do CDI entrega R$ 14.465,62 em 3 anos.';
		expect(validateVerdictText(text, facts)).toEqual({ valid: true });
	});

	it('recusa número que não está nos fatos', () => {
		expect(
			validateVerdictText('O CDB 110% do CDI rende 9,40% reais ao ano.', facts)
		).toEqual({ valid: false, reason: 'unknown_number' });
	});

	it('recusa prazo diferente do simulado ("36 meses")', () => {
		expect(
			validateVerdictText(
				'O CDB 110% do CDI vence em 36 meses com 8,23% reais.',
				facts
			)
		).toEqual({ valid: false, reason: 'unknown_number' });
	});

	it('recusa título do Tesouro que não está na tabela', () => {
		expect(
			validateVerdictText(
				'O CDB 110% do CDI supera o Tesouro IPCA+ 2045 com 8,23%.',
				facts
			)
		).toEqual({ valid: false, reason: 'unknown_instrument' });
		expect(
			validateVerdictText(
				'O CDB 110% do CDI supera o Tesouro Selic com 8,23%.',
				facts
			)
		).toEqual({ valid: false, reason: 'unknown_instrument' });
	});

	it('aceita citar o tipo do Tesouro sem o ano quando existe um da família', () => {
		expect(
			validateVerdictText(
				'O CDB 110% do CDI (8,23%) supera o Tesouro IPCA+ (5,94%).',
				facts
			)
		).toEqual({ valid: true });
	});

	it.each([
		'O CDB 110% do CDI rende 8,23% reais e supera a poupança.',
		'O CDB 110% do CDI rende 8,23% reais; uma LCA equivalente renderia menos.',
		'O CDB 110% do CDI rende 8,23% reais, mais que os fundos DI.',
		'O CDB 110% do CDI rende 8,23% reais, acima da LTN.',
	])('recusa produto que não está na tabela: %s', (text) => {
		expect(validateVerdictText(text, facts)).toEqual({
			valid: false,
			reason: 'unknown_product',
		});
	});

	it('produto da tabela pode ser citado (CDB, LCI, e o que aparece nos pontos)', () => {
		expect(
			validateVerdictText(
				'O CDB 110% do CDI (8,23%) fica à frente da LCI 95% do CDI (8,06%).',
				facts
			)
		).toEqual({ valid: true });
	});

	it.each([
		'Compre o CDB 110% do CDI, que rende 8,23% reais.',
		'Eu recomendo o CDB 110% do CDI: 8,23% reais.',
		'Vale investir no CDB 110% do CDI com 8,23% reais.',
	])('recusa linguagem de recomendação: %s', (text) => {
		expect(validateVerdictText(text, facts)).toEqual({
			valid: false,
			reason: 'recommendation_language',
		});
	});

	it('"venda antes do vencimento" (substantivo) não é recomendação', () => {
		expect(
			validateVerdictText(
				'O CDB 110% do CDI rende 8,23% reais; já a venda antecipada do Tesouro IPCA+ 2035 sofre marcação a mercado.',
				facts
			)
		).toEqual({ valid: true });
	});

	it('exige que o vencedor apareça pelo nome', () => {
		expect(
			validateVerdictText('A LCI 95% do CDI rende 8,06% reais ao ano.', facts)
		).toEqual({ valid: false, reason: 'missing_winner' });
	});

	it.each([
		['', 'empty'],
		['   ', 'empty'],
		[null, 'empty'],
		[undefined, 'empty'],
		[42, 'empty'],
	])('recusa texto vazio ou de tipo errado: %p', (text, reason) => {
		expect(validateVerdictText(text, facts)).toEqual({ valid: false, reason });
	});

	it('recusa texto longo demais', () => {
		const text = `CDB 110% do CDI ${'x '.repeat(400)}`;
		expect(validateVerdictText(text, facts)).toEqual({
			valid: false,
			reason: 'too_long',
		});
	});
});
