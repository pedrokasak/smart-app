import { SPOKEN_TEXT_MAX_CHARS, toSpokenText } from './spoken-text';

describe('toSpokenText', () => {
	it('tira marcação, link e marcador de lista e junta as linhas em frases', () => {
		const message = [
			'**Segundo os documentos de RI de PETR4:**',
			'• Receita cresceu 12% (Release 3T26, 05/11/2026, p. 4)',
			'• Mais em https://ri.petrobras.com.br/x',
		].join('\n');

		expect(toSpokenText(message)).toBe(
			'Segundo os documentos de RI de PETR4: Receita cresceu 12% (Release 3T26, 05/11/2026, p. 4). Mais em.'
		);
	});

	it('mantém o texto curto como está', () => {
		expect(toSpokenText('A PETR4 pagou R$ 1.248,30 este ano.')).toBe(
			'A PETR4 pagou R$ 1.248,30 este ano.'
		);
	});

	it('corta no fim de frase e manda para o chat quando passa do teto', () => {
		const sentence = 'Esta é uma frase de teste com algumas palavras. ';
		const spoken = toSpokenText(sentence.repeat(30));

		expect(spoken.length).toBeLessThanOrEqual(SPOKEN_TEXT_MAX_CHARS);
		expect(spoken.endsWith('palavras. Os detalhes estão no chat.')).toBe(true);
	});

	it('sem frase inteira que caiba, corta na palavra', () => {
		const spoken = toSpokenText('palavra '.repeat(200), 80);

		expect(spoken.length).toBeLessThanOrEqual(80);
		expect(spoken).toMatch(/palavra… Os detalhes estão no chat\.$/);
	});

	it('mensagem vazia vira texto vazio', () => {
		expect(toSpokenText('')).toBe('');
	});
});
