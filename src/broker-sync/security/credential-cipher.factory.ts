import { brokerEncryptionKey, brokerEncryptionKeyLegacy } from 'src/env';
import { AesGcmCredentialCipher } from './aes-gcm-credential-cipher';
import {
	BrokerCipherKeyError,
	BrokerCredentialCipher,
} from './broker-credential-cipher';
import { DisabledCredentialCipher } from './disabled-credential-cipher';

/** AES-256 exige 256 bits de material de chave. */
const KEY_BYTES = 32;
const KEY_HEX_LENGTH = KEY_BYTES * 2;

/**
 * Le e valida `BROKER_ENCRYPTION_KEY`.
 *
 * A chave e usada COMO material de chave (nao passa por KDF) porque a origem
 * documentada e `openssl rand -hex 32`: 256 bits uniformes de um CSPRNG. Um
 * KDF sobre entrada ja uniforme nao adiciona entropia; o que adiciona
 * seguranca e recusar qualquer entrada que NAO seja uniforme — e e isso que a
 * validacao de formato faz aqui. O formato antigo aceitava a string bruta em
 * utf8, sem checagem nenhuma: uma chave de tamanho errado so estourava na hora
 * em que o usuario salvava a credencial.
 *
 * @returns `null` quando a variavel esta ausente (feature desligada).
 * @throws {BrokerCipherKeyError} quando esta presente e malformada.
 */
export function readBrokerEncryptionKey(): Buffer | null {
	const raw = (brokerEncryptionKey ?? '').trim();
	if (!raw) return null;

	if (raw.length !== KEY_HEX_LENGTH || !/^[0-9a-fA-F]+$/.test(raw)) {
		throw new BrokerCipherKeyError(
			`BROKER_ENCRYPTION_KEY invalida: esperados ${KEY_HEX_LENGTH} ` +
				`caracteres hexadecimais (${KEY_BYTES} bytes), recebidos ` +
				`${raw.length} caracteres. Gere com: openssl rand -hex 32`
		);
	}

	return Buffer.from(raw, 'hex');
}

/**
 * Le e valida `BROKER_ENCRYPTION_KEY_LEGACY` — a chave do formato v1
 * (AES-256-CBC), usada SOMENTE para leitura de linhas antigas.
 *
 * O formato antigo fazia `Buffer.from(chave)`, ou seja, tratava a string do
 * ambiente como bytes utf8 diretos. A leitura legada precisa reproduzir essa
 * interpretacao exatamente — por isso aqui a validacao e "32 BYTES em utf8",
 * e nao "64 caracteres hexadecimais" como na chave nova.
 *
 * @returns `null` quando ausente (nao ha linhas antigas a migrar).
 * @throws {BrokerCipherKeyError} quando presente e com tamanho errado.
 */
export function readLegacyCbcKey(): Buffer | null {
	const raw = brokerEncryptionKeyLegacy ?? '';
	if (!raw) return null;

	const bytes = Buffer.from(raw, 'utf8');
	if (bytes.length !== KEY_BYTES) {
		throw new BrokerCipherKeyError(
			`BROKER_ENCRYPTION_KEY_LEGACY invalida: esperados ${KEY_BYTES} bytes ` +
				`em utf8 (o formato antigo usava a string crua como chave), ` +
				`recebidos ${bytes.length}.`
		);
	}

	return bytes;
}

/**
 * Monta a cifra de credenciais a partir do ambiente (TRA-144).
 *
 * Duas situacoes, tratadas de formas diferentes DE PROPOSITO:
 *
 *   AUSENTE  -> `DisabledCredentialCipher`. Nao ter a variavel e uma escolha
 *               de deploy legitima (a instalacao nao usa corretoras). O boot
 *               segue; conectar e sincronizar respondem 503 com mensagem de
 *               operador. Mesma politica do VAPID na fase 6.
 *
 *   MALFORMADA -> lanca, e o boot do Nest cai. Quem definiu a variavel QUER a
 *               feature ligada; desligar em silencio esconderia o engano ate
 *               o primeiro usuario tentar salvar uma credencial. `src/env.ts`
 *               ja tem esse precedente (`process.exit(1)` em env invalido).
 *
 * O que NAO existe mais em hipotese alguma: fallback para chave embutida no
 * codigo. Cifrar sob uma chave publicada no repositorio nao e cifrar.
 */
export function createBrokerCredentialCipher(): BrokerCredentialCipher {
	const key = readBrokerEncryptionKey();
	if (!key) return new DisabledCredentialCipher();

	return new AesGcmCredentialCipher(key, readLegacyCbcKey());
}
