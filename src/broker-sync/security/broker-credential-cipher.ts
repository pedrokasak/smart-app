/**
 * Porta de cifragem das credenciais de corretora (TRA-144).
 *
 * As credenciais de API de corretora (`apiKey`, `apiSecret`, `apiPassphrase`)
 * sao o segredo de maior valor guardado por este servico: com elas, quem le o
 * banco fala com a exchange no lugar do usuario. Elas nao podem ser um `hash`
 * (o servico precisa do valor original para assinar a chamada), entao a unica
 * protecao possivel e cifragem autenticada com chave que NAO mora no
 * repositorio.
 *
 * A porta existe para tirar a criptografia de dentro do `BrokerSyncService`,
 * que ja faz HTTP, regra de negocio e persistencia. Assim o algoritmo vira
 * uma unidade pequena e testavel, e a ausencia de configuracao vira um null
 * object (`DisabledCredentialCipher`) em vez de um fallback silencioso.
 */
export interface BrokerCredentialCipher {
	/** Cifra um valor em claro. Lanca quando a cifra esta indisponivel. */
	encrypt(plaintext: string): string;
	/** Decifra um valor guardado. Lanca em adulteracao ou chave errada. */
	decrypt(stored: string): string;
	/** `false` quando a feature esta desligada por falta de configuracao. */
	isEnabled(): boolean;
}

/**
 * Cifra indisponivel: `BROKER_ENCRYPTION_KEY` ausente.
 *
 * Erro voltado ao OPERADOR, nao ao usuario final — o texto diz exatamente
 * qual variavel falta e como gerar o valor. O servico mapeia para 503.
 */
export class BrokerCipherUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BrokerCipherUnavailableError';
	}
}

/**
 * `BROKER_ENCRYPTION_KEY` (ou a legada) presente porem malformada.
 *
 * Separado de `BrokerCipherUnavailableError` de proposito: ausencia e uma
 * escolha de deploy legitima (feature nao usada); malformacao e sempre um
 * engano de quem tentou ligar a feature, e por isso derruba o boot em vez de
 * desligar a feature em silencio.
 */
export class BrokerCipherKeyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BrokerCipherKeyError';
	}
}

/**
 * Falha ao decifrar: tag GCM invalida (adulteracao ou chave trocada), formato
 * irreconhecivel, ou valor legado sem `BROKER_ENCRYPTION_KEY_LEGACY`.
 *
 * NUNCA carrega o valor que falhou — nem em claro, nem cifrado.
 */
export class BrokerCredentialDecryptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BrokerCredentialDecryptionError';
	}
}

/**
 * Marcador de versao do formato guardado em banco.
 *
 * O prefixo existe para que decifrar uma linha antiga NAO dependa de
 * adivinhacao: o proprio valor diz em que formato foi escrito.
 *
 *   v2 (atual):  `v2:gcm:<ivHex>:<tagHex>:<ciphertextHex>`
 *   v1 (legado): `<ivHex>:<ciphertextHex>`  — AES-256-CBC, sem autenticacao
 *
 * `v2` nao colide com o legado porque o primeiro segmento legado e sempre
 * hexadecimal (o IV), e `v2` nao e hexadecimal valido de 32 caracteres.
 */
export const CIPHER_FORMAT_V2_PREFIX = 'v2';
export const CIPHER_FORMAT_V2_ALGORITHM = 'gcm';
