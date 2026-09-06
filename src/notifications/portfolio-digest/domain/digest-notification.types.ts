/**
 * O que avisamos ao usuario durante a semana, no formato que o e-mail
 * renderiza (TRA-136, fase 7).
 *
 * Tipo PROPRIO, e nao um campo novo em `PortfolioDigestFacts`, por um
 * motivo unico e deliberado: `PortfolioDigestFacts` e exatamente o
 * conjunto de fatos que vai para o narrador do trackerr-ia e contra o
 * qual `validateDigestNarrative` confere os tickers citados. Enfiar aqui
 * um texto que NAO e enviado ao narrador criaria duas classes de fato
 * dentro da mesma struct — e a primeira pessoa a mandar a struct inteira
 * para a IA passaria a alimentar o modelo com texto que a validacao nao
 * cobre. Separado, a invariante continua trivial de ler: tudo que esta
 * em `PortfolioDigestFacts` e narravel; isto aqui nunca e narrado.
 */
export interface DigestNotificationItem {
	/** Tipo do evento (NotificationType), util para a chave de render. */
	type: string;
	/** `buildTemplate(payload).title` — mesma copy do centro in-app. */
	title: string;
	/**
	 * `aiSummary` quando existe (fase 5), senao
	 * `buildTemplate(payload).description`. Nunca vazio: o mapper sempre
	 * devolve um dos dois, e itens sem nenhum texto sao descartados.
	 */
	body: string;
	/** ISO de `createdAt` do doc de notificacao. */
	occurredAt: string;
}

export interface DigestNotificationsSummary {
	items: DigestNotificationItem[];
	/**
	 * Quantas notificacoes do periodo ficaram DE FORA da lista por causa do
	 * teto. 0 = a lista e completa. O e-mail so renderiza a linha "e mais N"
	 * quando isto e maior que zero.
	 */
	omitted: number;
}

/**
 * Teto de itens listados no e-mail.
 *
 * Cinco, e nao "todas", porque o digest e um resumo do periodo e nao um
 * log: quem quer o historico completo tem o centro in-app, que ja pagina.
 * Cinco tambem e coerente com os tetos que o resto do digest ja usa (3
 * altas, 3 baixas, 3 pontos de atencao) — um pouco mais alto porque esta e
 * a unica secao que cobre a semana inteira, e menos que isso esconderia
 * uma semana normal de usuario ativo. Acima do teto o e-mail diz quantas
 * ficaram de fora em vez de calar: um usuario com 40 avisos precisa saber
 * que foram 40, sem receber 40 paragrafos.
 */
export const MAX_DIGEST_NOTIFICATIONS = 5;
