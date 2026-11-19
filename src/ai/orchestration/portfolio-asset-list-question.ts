/**
 * "Quais ativos eu tenho?", "liste minha carteira": pedido da lista de
 * posições com peso, e não do resumo. Usado pelo texto clássico do
 * Copiloto e pela camada didática, para os dois decidirem igual.
 */
export function isPortfolioAssetListQuestion(question: string): boolean {
	const text = String(question || '').toLowerCase();
	return (
		/\b(listar|liste|quais|mostrar|mostre|descrev\w*)\b/.test(text) &&
		/\b(ativos?|carteira|portf[oó]lio)\b/.test(text)
	);
}
