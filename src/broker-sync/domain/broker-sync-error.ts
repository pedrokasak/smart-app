/**
 * Categorias de falha de sincronizacao com corretora (TRK-011).
 *
 * Antes, `connection.lastError` guardava a mensagem CRUA da exchange e
 * `GET /broker-sync/connections` a devolvia. Algumas exchanges ecoam a URL
 * da requisicao dentro do texto de erro, e a URL carrega a API key. O valor
 * ficava no banco — o mesmo raio de exposicao da credencial cifrada que a
 * auditoria ja tinha apontado, so que em texto claro.
 *
 * A correcao NAO e redigir o texto do provedor por regex. Redacao por padrao
 * e jogo perdido: basta uma exchange formatar a chave de um jeito que o
 * padrao nao preve e o vazamento volta em silencio. Aqui o texto do provedor
 * simplesmente NAO E PERSISTIDO. O que persiste e uma categoria fechada,
 * escolhida por nos, mais o status HTTP numerico.
 *
 * Cada categoria precisa responder duas perguntas:
 *   - usuario: "o que eu faco agora?"
 *   - operador: "onde isso quebrou?"
 *
 * Este arquivo e puro: nao conhece ccxt, Mongoose, Nest nem HTTP. O mapa
 * ccxt -> categoria mora em `providers/ccxt-error-classifier.ts`.
 */

export const BROKER_SYNC_ERROR_CATEGORIES = [
	/** Chave/secret recusados. Acao: revisar credencial e reconectar. */
	'invalid_credentials',
	/** Chave valida, mas sem escopo de leitura. Acao: habilitar permissao. */
	'permission_denied',
	/** Conta bloqueada do lado da corretora. Acao: falar com a corretora. */
	'account_suspended',
	/** Chave em formato que nao parseia (caso classico da Coinbase/PEM). */
	'invalid_key_format',
	/** Limite de requisicoes. Acao: esperar. */
	'rate_limited',
	/** Corretora fora do ar ou em manutencao. Acao: esperar. */
	'exchange_unavailable',
	/** Corretora nao respondeu no tempo. Acao: tentar de novo. */
	'network_timeout',
	/** Falha de rede generica ate a corretora. */
	'network_error',
	/** Nonce/timestamp recusado — relogio fora de sincronia. */
	'clock_skew',
	/** A corretora recusou a requisicao em si (parametro, simbolo, rota). */
	'invalid_request',
	/** Erro da corretora que nao cai em nenhuma das anteriores. */
	'exchange_error',
	/** Nao foi possivel classificar. */
	'unknown',
] as const;

export type BrokerSyncErrorCategory =
	(typeof BROKER_SYNC_ERROR_CATEGORIES)[number];

/**
 * Mensagens em pt-BR, escritas para quem esta olhando a tela de conexoes.
 * Nenhuma delas interpola texto do provedor — sao constantes.
 */
const MESSAGES: Record<BrokerSyncErrorCategory, string> = {
	invalid_credentials:
		'Credencial inválida. Confira a API key e o secret na corretora e reconecte a integração.',
	permission_denied:
		'A chave não tem permissão para ler saldos. Habilite a permissão de leitura na corretora e reconecte.',
	account_suspended:
		'A conta na corretora está suspensa ou bloqueada. Resolva com a corretora e tente novamente.',
	invalid_key_format:
		'Formato de chave inválido. Use API Key + Private Key no formato PEM (com BEGIN/END) e informe a passphrase se a sua chave exigir.',
	rate_limited:
		'Limite de requisições da corretora atingido. Tente novamente em alguns minutos.',
	exchange_unavailable:
		'Corretora indisponível no momento. Tente novamente mais tarde.',
	network_timeout:
		'A corretora não respondeu a tempo. Tente novamente em alguns instantes.',
	network_error:
		'Falha de comunicação com a corretora. Tente novamente em alguns instantes.',
	clock_skew:
		'A corretora recusou a requisição por diferença de horário. Tente novamente em alguns instantes.',
	invalid_request:
		'A corretora recusou a requisição. Se o erro persistir, reconecte a integração.',
	exchange_error:
		'A corretora retornou um erro ao consultar o saldo. Tente novamente mais tarde.',
	unknown:
		'Não foi possível sincronizar com a corretora. Tente novamente mais tarde.',
};

/**
 * O que vai para o banco e para a resposta. Nada aqui vem do provedor em
 * texto: `category` e nossa, `message` e derivada dela, e `statusCode` e um
 * numero.
 */
export interface SanitizedBrokerError {
	category: BrokerSyncErrorCategory;
	message: string;
	/**
	 * Status HTTP devolvido pela corretora, quando houve resposta HTTP.
	 * Numero nao carrega segredo e e o que distingue, no suporte, um 401 de
	 * um 403 dentro da mesma categoria.
	 */
	statusCode?: number;
}

export function brokerSyncErrorMessage(
	category: BrokerSyncErrorCategory
): string {
	return MESSAGES[category] ?? MESSAGES.unknown;
}

export function sanitizedBrokerError(
	category: BrokerSyncErrorCategory,
	statusCode?: number
): SanitizedBrokerError {
	return {
		category,
		message: brokerSyncErrorMessage(category),
		...(typeof statusCode === 'number' && Number.isFinite(statusCode)
			? { statusCode }
			: {}),
	};
}

export function isBrokerSyncErrorCategory(
	value: unknown
): value is BrokerSyncErrorCategory {
	return (BROKER_SYNC_ERROR_CATEGORIES as readonly string[]).includes(
		String(value)
	);
}
