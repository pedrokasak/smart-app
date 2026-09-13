/**
 * Tipos do canal Web Push (TRA-136, fase 6).
 *
 * Camada pura: nada aqui conhece `web-push`, HTTP ou Mongo. O adaptador de
 * infraestrutura traduz o mundo real para estes tipos, e volta.
 */

/**
 * Assinatura no formato que o navegador produz
 * (`PushSubscription.toJSON()`). As chaves NUNCA aparecem em log, resposta
 * de rota ou mensagem de erro — sao material criptografico do endpoint.
 */
export type PushSubscriptionKeys = {
	p256dh: string;
	auth: string;
};

/** O alvo minimo que o sender precisa para cifrar e entregar. */
export type PushTarget = {
	endpoint: string;
	keys: PushSubscriptionKeys;
};

/**
 * Corpo entregue ao service worker. Deliberadamente magro: push services
 * cortam acima de ~4KB e nao ha motivo para carregar o texto integral das
 * notificacoes — o app busca o detalhe no centro in-app quando o usuario
 * clica.
 */
export type WebPushPayload = {
	title: string;
	body: string;
	/** Agrupa/colapsa avisos do mesmo dia no SO em vez de empilhar. */
	tag: string;
	/** Rota relativa aberta no clique. O service worker prefixa a origem. */
	url: string;
	/** Quantas notificacoes o resumo representa. */
	count: number;
};

/** Teto do payload cifrado aceito pelos push services mais restritos. */
export const MAX_PUSH_PAYLOAD_BYTES = 4096;

/**
 * Margem de seguranca sobre o teto: a cifragem aes128gcm adiciona overhead
 * ao JSON, entao validamos o texto claro bem abaixo do limite real.
 */
export const MAX_PUSH_PAYLOAD_PLAINTEXT_BYTES = 2048;

/**
 * Resultado de UMA tentativa de entrega, ja classificado. O ponto desta
 * uniao e separar o que e permanente do que e passageiro:
 *
 *   - `expired`  -> 404/410. O endpoint morreu (navegador desinstalado,
 *                   permissao revogada, assinatura rotacionada). Apagar.
 *   - `transient`-> 429, 5xx, timeout, DNS. Tentar de novo amanha e contar.
 *   - `invalid`  -> 400/413 e afins: o payload/assinatura esta errado. Nao
 *                   e culpa do endpoint; nao apaga, mas tambem nao adianta
 *                   repetir sem mudar algo. Conta como falha.
 *   - `disabled` -> sem VAPID configurado. Nao e falha de ninguem.
 *
 * Tratar 429 como morte foi o bug classico deste tipo de integracao:
 * apagaria a base inteira de assinaturas no primeiro pico do provedor.
 */
export type PushDeliveryResult =
	| { outcome: 'sent' }
	| { outcome: 'expired'; statusCode: number }
	| { outcome: 'invalid'; statusCode: number; error: string }
	| { outcome: 'transient'; error: string; statusCode?: number }
	| { outcome: 'disabled' };
