/**
 * Texto que a voz lê em voz alta, derivado da resposta que o orquestrador
 * já deu (ADR-007, decisão 3). Nunca acrescenta conteúdo: só tira o que
 * soa mal falado e encurta.
 */

export const SPOKEN_TEXT_MAX_CHARS = 600;
const SEE_CHAT = 'Os detalhes estão no chat.';

export function toSpokenText(
	message: string,
	maxChars: number = SPOKEN_TEXT_MAX_CHARS
): string {
	const text = String(message || '')
		// Marcação de ênfase e títulos não se falam.
		.replace(/\*\*|__|`/g, '')
		.replace(/^#+\s*/gm, '')
		// Link não se lê em voz alta.
		.replace(/https?:\/\/\S+/g, '')
		// Itens de lista viram frases.
		.replace(/^\s*[•\-*]\s+/gm, '')
		.split(/\n+/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => (/[.!?:;]$/.test(line) ? line : `${line}.`))
		.join(' ')
		.replace(/\s{2,}/g, ' ')
		.trim();

	if (text.length <= maxChars) return text;

	const room = maxChars - SEE_CHAT.length - 1;
	const head = text.slice(0, room);
	// Corta no fim da última frase que coube; sem frase inteira, na última
	// palavra.
	const sentenceEnd = Math.max(
		head.lastIndexOf('. '),
		head.lastIndexOf('! '),
		head.lastIndexOf('? ')
	);
	const cut =
		sentenceEnd > 0
			? head.slice(0, sentenceEnd + 1)
			: `${head.slice(0, head.lastIndexOf(' ')).trim()}…`;
	return `${cut} ${SEE_CHAT}`;
}
