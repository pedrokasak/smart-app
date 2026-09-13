/**
 * Porta do contador do rate limit por endpoint (TRA-138).
 *
 * O middleware conhece a POLITICA (quais rotas, quantas requisicoes, qual
 * janela) e nada sobre onde o contador mora. A porta conhece o ARMAZENAMENTO
 * e nada sobre limites: quem compara `count` com o teto e o middleware.
 *
 * A separacao existe porque o armazenamento e a parte que muda com a
 * topologia do deploy — uma instancia (Map em memoria) ou varias
 * (Redis compartilhado) — enquanto a politica e a mesma nos dois casos.
 */

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

/**
 * Resultado de UMA passagem pelo contador.
 *
 * `unavailable` nao e erro do chamador: e o sinal de que o armazenamento nao
 * respondeu e a decisao precisa ser tomada sem contador. O middleware trata
 * isso como fail open (ver EndpointRateLimitMiddleware).
 */
export type RateLimitHit =
	| {
			outcome: 'counted';
			/** Quantas requisicoes ja entraram nesta janela, incluindo esta. */
			count: number;
			/** Quanto falta, em ms, para a janela zerar. */
			resetInMs: number;
	  }
	| { outcome: 'unavailable'; error: string };

export interface RateLimitStore {
	/**
	 * Incrementa o contador de `key` e devolve o estado da janela.
	 *
	 * Contrato obrigatorio para qualquer implementacao:
	 *
	 * 1. ATOMICO. Ler-e-depois-escrever perde incrementos exatamente sob
	 *    concorrencia, que e a condicao que um ataque de forca bruta cria.
	 * 2. JANELA FIXA. A janela nasce no primeiro incremento e vale
	 *    `windowMs`; ao expirar, o proximo incremento comeca uma janela nova
	 *    do zero. Nao e sliding window.
	 * 3. COM TTL. A chave expira sozinha ao fim da janela — chave abandonada
	 *    nao pode acumular.
	 * 4. NUNCA LANCA. Falha de infraestrutura vira `outcome: 'unavailable'`.
	 */
	hit(key: string, windowMs: number): Promise<RateLimitHit>;
}
