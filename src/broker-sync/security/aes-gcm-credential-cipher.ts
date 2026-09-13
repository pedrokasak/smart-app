import * as crypto from 'crypto';
import {
	BrokerCredentialCipher,
	BrokerCredentialDecryptionError,
	CIPHER_FORMAT_V2_ALGORITHM,
	CIPHER_FORMAT_V2_PREFIX,
} from './broker-credential-cipher';

/** 96 bits: o tamanho de nonce recomendado pelo NIST SP 800-38D para GCM. */
const GCM_IV_BYTES = 12;
/** 128 bits: tag completa. Truncar a tag reduz a forca da autenticacao. */
const GCM_TAG_BYTES = 16;
/** O legado usava CBC com IV de 128 bits. */
const LEGACY_CBC_IV_BYTES = 16;

/**
 * Cifra autenticada AES-256-GCM para credenciais de corretora (TRA-144).
 *
 * POR QUE GCM E NAO CBC. O formato anterior era `aes-256-cbc` sem MAC: o
 * texto cifrado e maleavel (flipar um bit do bloco N flipa o bit
 * correspondente do bloco N+1 em claro) e o unico sinal de erro e a falha de
 * padding — exatamente o oraculo que ataques de padding exploram. GCM
 * autentica: decifrar so devolve valor quando a tag confere, e uma tag que
 * nao confere e ADULTERACAO, nao "erro de decodificacao".
 *
 * A classe nao le ambiente: recebe as chaves ja validadas. Quem le e valida
 * e `credential-cipher.factory.ts`. Assim o algoritmo e testavel sem mexer em
 * `process.env`, e a decisao de "desligar quando falta chave" mora num lugar
 * so.
 */
export class AesGcmCredentialCipher implements BrokerCredentialCipher {
	/**
	 * @param key material de 32 bytes para AES-256-GCM (escrita e leitura v2).
	 * @param legacyCbcKey material de 32 bytes da cifra CBC antiga. Somente
	 *   LEITURA de linhas v1 — nada e escrito em CBC nunca mais. `null` quando
	 *   o operador nao configurou `BROKER_ENCRYPTION_KEY_LEGACY`; nesse caso
	 *   linhas antigas falham com mensagem explicita em vez de devolver lixo.
	 */
	constructor(
		private readonly key: Buffer,
		private readonly legacyCbcKey: Buffer | null = null
	) {}

	isEnabled(): boolean {
		return true;
	}

	encrypt(plaintext: string): string {
		const iv = crypto.randomBytes(GCM_IV_BYTES);
		const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv, {
			authTagLength: GCM_TAG_BYTES,
		});
		const ciphertext = Buffer.concat([
			cipher.update(plaintext, 'utf8'),
			cipher.final(),
		]);
		const tag = cipher.getAuthTag();

		return [
			CIPHER_FORMAT_V2_PREFIX,
			CIPHER_FORMAT_V2_ALGORITHM,
			iv.toString('hex'),
			tag.toString('hex'),
			ciphertext.toString('hex'),
		].join(':');
	}

	decrypt(stored: string): string {
		const value = (stored ?? '').trim();
		if (!value) {
			throw new BrokerCredentialDecryptionError(
				'Credencial de corretora vazia no banco.'
			);
		}

		const parts = value.split(':');
		if (parts[0] === CIPHER_FORMAT_V2_PREFIX) {
			return this.decryptV2(parts);
		}
		return this.decryptLegacyCbc(parts);
	}

	private decryptV2(parts: string[]): string {
		const [, algorithm, ivHex, tagHex, ciphertextHex] = parts;
		if (algorithm !== CIPHER_FORMAT_V2_ALGORITHM || parts.length !== 5) {
			throw new BrokerCredentialDecryptionError(
				'Formato de credencial v2 invalido.'
			);
		}

		const iv = this.decodeHex(ivHex, GCM_IV_BYTES, 'IV');
		const tag = this.decodeHex(tagHex, GCM_TAG_BYTES, 'tag de autenticacao');
		const ciphertext = this.decodeHex(ciphertextHex, null, 'texto cifrado');

		const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv, {
			authTagLength: GCM_TAG_BYTES,
		});
		decipher.setAuthTag(tag);

		try {
			return Buffer.concat([
				decipher.update(ciphertext),
				decipher.final(),
			]).toString('utf8');
		} catch {
			// `final()` so falha aqui quando a tag nao confere. Isso e
			// adulteracao do registro ou chave trocada — nunca "decode error".
			throw new BrokerCredentialDecryptionError(
				'Falha na verificacao de integridade da credencial (AES-GCM). ' +
					'O valor guardado foi adulterado ou BROKER_ENCRYPTION_KEY mudou. ' +
					'A credencial precisa ser reinformada pelo usuario.'
			);
		}
	}

	/**
	 * Leitura das linhas escritas antes do TRA-144 (`<ivHex>:<ciphertextHex>`,
	 * AES-256-CBC). Existe para que a troca de formato nao derrube conexoes ja
	 * cadastradas: a linha antiga continua legivel e e regravada em v2 no
	 * proximo `POST /broker-sync/connect` do usuario.
	 *
	 * Nao ha adivinhacao de chave: se `BROKER_ENCRYPTION_KEY_LEGACY` nao foi
	 * configurada, isto falha dizendo exatamente o que falta.
	 */
	private decryptLegacyCbc(parts: string[]): string {
		if (!this.legacyCbcKey) {
			throw new BrokerCredentialDecryptionError(
				'Credencial no formato legado (AES-256-CBC) e ' +
					'BROKER_ENCRYPTION_KEY_LEGACY nao configurada. Configure a chave ' +
					'antiga para migrar, ou peca ao usuario para reconectar a corretora.'
			);
		}
		if (parts.length !== 2) {
			throw new BrokerCredentialDecryptionError(
				'Formato de credencial legado invalido.'
			);
		}

		const iv = this.decodeHex(parts[0], LEGACY_CBC_IV_BYTES, 'IV legado');
		const ciphertext = this.decodeHex(parts[1], null, 'texto cifrado legado');

		try {
			const decipher = crypto.createDecipheriv(
				'aes-256-cbc',
				this.legacyCbcKey,
				iv
			);
			return Buffer.concat([
				decipher.update(ciphertext),
				decipher.final(),
			]).toString('utf8');
		} catch {
			throw new BrokerCredentialDecryptionError(
				'Falha ao decifrar credencial no formato legado (AES-256-CBC). ' +
					'BROKER_ENCRYPTION_KEY_LEGACY provavelmente nao e a chave usada ' +
					'na escrita. A credencial precisa ser reinformada pelo usuario.'
			);
		}
	}

	/**
	 * `Buffer.from(x, 'hex')` ignora silenciosamente lixo nao-hexadecimal e
	 * devolve buffer curto. Validamos formato e tamanho explicitamente para que
	 * um campo truncado no banco vire erro claro, e nao um IV de tamanho errado
	 * estourando dentro do OpenSSL.
	 */
	private decodeHex(
		hex: string | undefined,
		expectedBytes: number | null,
		label: string
	): Buffer {
		if (!hex || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
			throw new BrokerCredentialDecryptionError(
				`Credencial corrompida: ${label} nao e hexadecimal valido.`
			);
		}
		const buffer = Buffer.from(hex, 'hex');
		if (expectedBytes !== null && buffer.length !== expectedBytes) {
			throw new BrokerCredentialDecryptionError(
				`Credencial corrompida: ${label} deveria ter ${expectedBytes} bytes.`
			);
		}
		return buffer;
	}
}
