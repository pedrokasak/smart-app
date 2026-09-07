import * as ccxt from 'ccxt';
import {
	BrokerSyncErrorCategory,
	SanitizedBrokerError,
	sanitizedBrokerError,
} from 'src/broker-sync/domain/broker-sync-error';

/**
 * Traduz o erro que a CCXT joga em uma categoria fechada (TRK-011).
 *
 * A CCXT tem hierarquia de erro tipada, entao a classificacao e por TIPO, nao
 * por texto. Isso importa: `error.message` e justamente o campo que pode
 * carregar a URL da requisicao (e, dentro dela, a API key), e casar padroes
 * nele significaria ler o valor perigoso para decidir. Aqui o texto do
 * provedor nunca e lido — so o tipo e o status HTTP.
 *
 * Hierarquia relevante (confirmada em ccxt 4.5):
 *
 *   AuthenticationError -> ExchangeError -> BaseError
 *     PermissionDenied  -> AuthenticationError
 *     AccountSuspended  -> AuthenticationError
 *   RateLimitExceeded     -> NetworkError -> OperationFailed -> BaseError
 *   DDoSProtection        -> NetworkError
 *   ExchangeNotAvailable  -> NetworkError
 *     OnMaintenance       -> ExchangeNotAvailable
 *   RequestTimeout        -> NetworkError
 *   InvalidNonce          -> NetworkError
 *   BadRequest            -> ExchangeError
 *
 * A ORDEM DA TABELA E O CONTRATO: subclasse antes da superclasse. Se
 * `AuthenticationError` viesse antes de `PermissionDenied`, toda falta de
 * permissao seria contada como credencial invalida e o usuario receberia a
 * instrucao errada ("troque a chave") para um problema de escopo.
 */
const CATEGORY_BY_CCXT_CLASS: ReadonlyArray<
	readonly [string, BrokerSyncErrorCategory]
> = [
	// --- ramo AuthenticationError, do mais especifico para o mais generico
	['AccountSuspended', 'account_suspended'],
	['PermissionDenied', 'permission_denied'],
	['AuthenticationError', 'invalid_credentials'],

	// --- ramo NetworkError
	['OnMaintenance', 'exchange_unavailable'],
	['ExchangeNotAvailable', 'exchange_unavailable'],
	// DDoSProtection e, na pratica, a exchange dizendo "devagar".
	['DDoSProtection', 'rate_limited'],
	['RateLimitExceeded', 'rate_limited'],
	['RequestTimeout', 'network_timeout'],
	['InvalidNonce', 'clock_skew'],
	['NetworkError', 'network_error'],

	// --- ramo ExchangeError
	['BadSymbol', 'invalid_request'],
	['BadRequest', 'invalid_request'],
	['ArgumentsRequired', 'invalid_request'],
	['NotSupported', 'invalid_request'],
	['ExchangeError', 'exchange_error'],
];

/**
 * Erros de PARSE DE CHAVE nao vem da CCXT: sao do `crypto` do Node, jogados
 * quando a Private Key da Coinbase chega fora do PEM. Nao ha classe tipada
 * para casar, entao aqui — e SO aqui — o texto e inspecionado.
 *
 * A diferenca em relacao a redigir o erro por regex e importante: o texto
 * lido nao vai para lugar nenhum. Ele decide uma categoria e e descartado.
 * Um falso negativo cai em `unknown`, que e seguro; nao existe caminho em
 * que o texto sobreviva a esta funcao.
 */
const KEY_FORMAT_SIGNATURES = [
	'Illegal character at offset',
	'Unsupported key format',
	'error:1E08010C', // DECODER routines::unsupported (OpenSSL 3)
	'no start line',
];

function hasKeyFormatSignature(message: string): boolean {
	return KEY_FORMAT_SIGNATURES.some((sig) => message.includes(sig));
}

/**
 * `instanceof` casa PRIMEIRO, porque e a verificacao correta. O fallback por
 * nome de classe existe por dois motivos reais:
 *
 *  - a CCXT pode acabar carregada em duas copias (transitiva + direta), e
 *    `instanceof` entre elas e falso mesmo sendo a "mesma" classe;
 *  - suites que fazem `jest.mock('ccxt', ...)` — a de `broker-sync.service`
 *    faz — deixam as classes de erro `undefined`, e sem o fallback toda a
 *    classificacao viraria `unknown` dentro dos testes.
 *
 * Nos dois casos ainda e classificacao por TIPO: o que se compara e a cadeia
 * de prototipos do erro, nunca a mensagem.
 */
function matchesCcxtClass(error: unknown, className: string): boolean {
	const Ctor = (ccxt as unknown as Record<string, unknown>)[className];
	if (typeof Ctor === 'function' && error instanceof (Ctor as never)) {
		return true;
	}
	return prototypeChainNames(error).includes(className);
}

function prototypeChainNames(error: unknown): string[] {
	const names: string[] = [];
	let proto: object | null =
		error && typeof error === 'object' ? Object.getPrototypeOf(error) : null;
	while (proto && proto !== Object.prototype) {
		const ctorName = (proto as { constructor?: { name?: string } }).constructor
			?.name;
		if (ctorName) names.push(ctorName);
		proto = Object.getPrototypeOf(proto);
	}
	// A CCXT tambem carimba `name` com o nome da classe. Redundante quase
	// sempre, mas cobre erro re-serializado que perdeu a cadeia.
	const stamped = (error as { name?: unknown })?.name;
	if (typeof stamped === 'string' && stamped && !names.includes(stamped)) {
		names.push(stamped);
	}
	return names;
}

/**
 * Status HTTP, quando existir. E numero: nao carrega segredo e distingue,
 * dentro da mesma categoria, o 401 do 403 na hora do suporte.
 */
function extractStatusCode(error: unknown): number | undefined {
	const candidate = error as {
		httpStatus?: unknown;
		status?: unknown;
		statusCode?: unknown;
		response?: { status?: unknown };
	};
	for (const value of [
		candidate?.httpStatus,
		candidate?.response?.status,
		candidate?.status,
		candidate?.statusCode,
	]) {
		const parsed = Number(value);
		if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) {
			return parsed;
		}
	}
	return undefined;
}

export function classifyBrokerError(error: unknown): SanitizedBrokerError {
	const statusCode = extractStatusCode(error);

	const rawMessage =
		typeof (error as { message?: unknown })?.message === 'string'
			? ((error as { message: string }).message ?? '')
			: '';

	// Antes da tabela: a CCXT embrulha a falha de parse de chave em
	// ExchangeError, entao consultar a tabela primeiro devolveria
	// `exchange_error` e perderia a unica instrucao acionavel que existe
	// para este caso.
	if (hasKeyFormatSignature(rawMessage)) {
		return sanitizedBrokerError('invalid_key_format', statusCode);
	}

	for (const [className, category] of CATEGORY_BY_CCXT_CLASS) {
		if (matchesCcxtClass(error, className)) {
			return sanitizedBrokerError(category, statusCode);
		}
	}

	return sanitizedBrokerError('unknown', statusCode);
}

/**
 * Linha de log para o operador. Traz categoria, status e o NOME da classe de
 * erro — o suficiente para achar a causa — e nunca a mensagem do provedor,
 * porque log e mais um lugar onde uma API key ecoada nao deveria parar.
 */
export function brokerErrorLogLabel(
	error: unknown,
	sanitized: SanitizedBrokerError
): string {
	const [className] = prototypeChainNames(error);
	return [
		`categoria=${sanitized.category}`,
		className ? `tipo=${className}` : null,
		sanitized.statusCode ? `status=${sanitized.statusCode}` : null,
	]
		.filter(Boolean)
		.join(' ');
}
