export const BREACHED_PASSWORD_CHECKER = Symbol('BREACHED_PASSWORD_CHECKER');

/**
 * Veredito de tres estados, nao booleano (TRK-012).
 *
 * `unknown` existe porque a checagem depende de um servico de terceiro que
 * um dia vai estar fora do ar. Com booleano, essa terceira realidade teria
 * que ser espremida em `false` DENTRO do adaptador — e a decisao de politica
 * mais importante desta feature ("falhar aberto") ficaria escondida num
 * `catch`, invisivel para quem le o caso de uso.
 *
 * Com tres estados, quem decide e o `BreachedPasswordPolicy`, em uma linha
 * que da para ler: so `breached` recusa.
 */
export type BreachedPasswordVerdict = 'breached' | 'not_breached' | 'unknown';

/**
 * Porta para a verificacao de senha vazada (ASVS 5.0 6.2.12, nivel L2).
 *
 * A implementacao de hoje consulta o range API do Have I Been Pwned. A porta
 * existe para que isso seja substituivel por um corpus local (um filtro de
 * Bloom com as senhas mais vazadas, por exemplo) sem tocar em nenhum caso de
 * uso — e para que o teste do fluxo de cadastro nao precise de rede.
 */
export interface BreachedPasswordChecker {
	/**
	 * NUNCA deve lancar. Indisponibilidade e `unknown`, nao excecao: quem
	 * chama esta no meio de um cadastro e nao tem o que fazer com um erro.
	 */
	check(password: string): Promise<BreachedPasswordVerdict>;
}
