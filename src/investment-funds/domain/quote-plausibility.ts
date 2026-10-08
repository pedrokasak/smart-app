/**
 * A posição de fundo vale cotas × cota (TRA-276). Se a pessoa digitou o valor
 * aplicado como "preço da cota" (1 cota de R$ 10.000 num fundo com cota de
 * R$ 2,50), marcar a mercado transformaria R$ 10 mil em R$ 2,50. Fora desta
 * faixa a posição fica com o preço informado, que é o dado que a pessoa deu.
 *
 * 50× cobre décadas de valorização de cota (um fundo DI dobra a cota em
 * ~6 anos com CDI a 12%) e ainda pega o erro de digitação, que costuma
 * passar de 1.000×.
 */
export const MAX_QUOTE_DRIFT = 50;

export function isPlausibleQuote(entryPrice: number, quota: number): boolean {
	if (!(entryPrice > 0) || !(quota > 0)) return false;
	const ratio = quota / entryPrice;
	return ratio <= MAX_QUOTE_DRIFT && ratio >= 1 / MAX_QUOTE_DRIFT;
}
