/** "Ações Multimercado" → "acoes multimercado": a busca ignora acento e caixa. */
export function toSearchText(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

export function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Até 6 palavras de pelo menos 2 letras; o resto é ruído para a busca. */
export function searchTerms(query: string): string[] {
	return toSearchText(query)
		.split(' ')
		.filter((term) => term.length >= 2)
		.slice(0, 6);
}
