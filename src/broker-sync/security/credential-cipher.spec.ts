import * as crypto from 'crypto';
import { AesGcmCredentialCipher } from './aes-gcm-credential-cipher';
import { DisabledCredentialCipher } from './disabled-credential-cipher';
import {
	BrokerCipherUnavailableError,
	BrokerCredentialDecryptionError,
} from './broker-credential-cipher';

/**
 * A fabrica le `src/env`, que congela `process.env` no import. Para testar as
 * duas politicas (ausente = desligado, malformada = boot cai) sem depender da
 * ordem de import, mockamos o modulo de env por teste.
 */
const loadFactory = (
	key?: string,
	legacy?: string
): typeof import('./credential-cipher.factory') => {
	jest.resetModules();
	jest.doMock('src/env', () => ({
		brokerEncryptionKey: key,
		brokerEncryptionKeyLegacy: legacy,
	}));
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	return require('./credential-cipher.factory');
};

/**
 * `jest.resetModules()` recarrega tambem o modulo das classes de erro, entao
 * o construtor recarregado nao e identico ao importado estaticamente aqui.
 * Comparar pelo `name` testa o contrato real (o tipo do erro) sem depender da
 * identidade do modulo.
 */
const expectErrorNamed = (name: string, fn: () => unknown) => {
	expect(fn).toThrow();
	try {
		fn();
		throw new Error('esperava excecao');
	} catch (error) {
		expect((error as Error).name).toBe(name);
		return error as Error;
	}
};

const VALID_KEY_HEX = 'a'.repeat(64);
const OTHER_KEY_HEX = 'b'.repeat(64);

describe('AesGcmCredentialCipher', () => {
	const key = Buffer.from(VALID_KEY_HEX, 'hex');
	const cipher = new AesGcmCredentialCipher(key);

	it('faz round-trip de encrypt/decrypt sob AES-256-GCM', () => {
		const secret = 'sk_live_binance_ABC123-áçãô';
		const stored = cipher.encrypt(secret);

		expect(cipher.decrypt(stored)).toBe(secret);
	});

	it('grava no formato versionado v2:gcm:<iv>:<tag>:<ciphertext>', () => {
		const parts = cipher.encrypt('valor').split(':');

		expect(parts).toHaveLength(5);
		expect(parts[0]).toBe('v2');
		expect(parts[1]).toBe('gcm');
		expect(parts[2]).toHaveLength(24); // IV de 12 bytes
		expect(parts[3]).toHaveLength(32); // tag de 16 bytes
		expect(parts[4].length).toBeGreaterThan(0);
	});

	it('usa IV distinto a cada chamada (mesmo texto, cifra diferente)', () => {
		expect(cipher.encrypt('mesmo')).not.toBe(cipher.encrypt('mesmo'));
	});

	it('rejeita texto cifrado adulterado como violacao de integridade', () => {
		const parts = cipher.encrypt('valor-original').split(':');
		const body = Buffer.from(parts[4], 'hex');
		body[0] ^= 0xff; // flipa um bit do ciphertext
		parts[4] = body.toString('hex');

		expect(() => cipher.decrypt(parts.join(':'))).toThrow(
			BrokerCredentialDecryptionError
		);
		expect(() => cipher.decrypt(parts.join(':'))).toThrow(/integridade/i);
	});

	it('rejeita tag de autenticacao adulterada', () => {
		const parts = cipher.encrypt('valor-original').split(':');
		const tag = Buffer.from(parts[3], 'hex');
		tag[0] ^= 0xff;
		parts[3] = tag.toString('hex');

		expect(() => cipher.decrypt(parts.join(':'))).toThrow(
			BrokerCredentialDecryptionError
		);
	});

	it('rejeita valor cifrado com outra chave', () => {
		const stored = new AesGcmCredentialCipher(
			Buffer.from(OTHER_KEY_HEX, 'hex')
		).encrypt('valor');

		expect(() => cipher.decrypt(stored)).toThrow(
			BrokerCredentialDecryptionError
		);
	});

	it('rejeita formato irreconhecivel sem vazar o valor na mensagem', () => {
		expect(() => cipher.decrypt('v2:gcm:naohex:naohex:naohex')).toThrow(
			BrokerCredentialDecryptionError
		);
		expect(() => cipher.decrypt('')).toThrow(BrokerCredentialDecryptionError);
		try {
			cipher.decrypt('v2:gcm:zz:zz:zz');
		} catch (error) {
			expect((error as Error).message).not.toContain('zz:zz:zz');
		}
	});

	describe('leitura de valores legados (v1, AES-256-CBC)', () => {
		// Reproduz exatamente a escrita antiga: string crua como bytes utf8.
		const legacyKeyString = '0123456789abcdef0123456789abcdef';
		const legacyKey = Buffer.from(legacyKeyString, 'utf8');
		const writeLegacy = (plaintext: string) => {
			const iv = crypto.randomBytes(16);
			const c = crypto.createCipheriv('aes-256-cbc', legacyKey, iv);
			return (
				iv.toString('hex') +
				':' +
				c.update(plaintext, 'utf8', 'hex') +
				c.final('hex')
			);
		};

		it('decifra valor legado quando a chave antiga esta configurada', () => {
			const dual = new AesGcmCredentialCipher(key, legacyKey);

			expect(dual.decrypt(writeLegacy('chave-antiga'))).toBe('chave-antiga');
		});

		it('nao adivinha: falha com mensagem clara sem a chave legada', () => {
			expect(() => cipher.decrypt(writeLegacy('chave-antiga'))).toThrow(
				/BROKER_ENCRYPTION_KEY_LEGACY/
			);
		});

		it('falha quando a chave legada configurada nao e a da escrita', () => {
			const wrong = new AesGcmCredentialCipher(
				key,
				Buffer.from('f'.repeat(32), 'utf8')
			);

			expect(() => wrong.decrypt(writeLegacy('chave-antiga'))).toThrow(
				BrokerCredentialDecryptionError
			);
		});
	});
});

describe('DisabledCredentialCipher', () => {
	it('recusa cifrar e diz ao operador qual variavel falta', () => {
		const disabled = new DisabledCredentialCipher();

		expect(disabled.isEnabled()).toBe(false);
		expect(() => disabled.encrypt()).toThrow(BrokerCipherUnavailableError);
		expect(() => disabled.encrypt()).toThrow(/BROKER_ENCRYPTION_KEY/);
		expect(() => disabled.encrypt()).toThrow(/openssl rand -hex 32/);
		expect(() => disabled.decrypt()).toThrow(BrokerCipherUnavailableError);
	});
});

describe('createBrokerCredentialCipher', () => {
	afterEach(() => {
		jest.dontMock('src/env');
		jest.resetModules();
	});

	it('sem BROKER_ENCRYPTION_KEY, devolve a cifra desligada (fail closed)', () => {
		const factory = loadFactory(undefined);
		const cipher = factory.createBrokerCredentialCipher();

		expect(cipher.isEnabled()).toBe(false);
		expectErrorNamed('BrokerCipherUnavailableError', () =>
			cipher.encrypt('segredo')
		);
	});

	it('trata string vazia/em branco como ausente', () => {
		const cipher = loadFactory('   ').createBrokerCredentialCipher();

		expect(cipher.isEnabled()).toBe(false);
	});

	it('nao possui mais fallback embutido: nada e cifrado sem chave', () => {
		const cipher = loadFactory(undefined).createBrokerCredentialCipher();
		let produced: string | undefined;

		try {
			produced = cipher.encrypt('apiSecret-do-usuario');
		} catch {
			produced = undefined;
		}

		expect(produced).toBeUndefined();
	});

	it('rejeita a antiga chave embutida (32 chars, nao hex de 32 bytes)', () => {
		const factory = loadFactory('0123456789abcdef0123456789abcdef');
		const error = expectErrorNamed('BrokerCipherKeyError', () =>
			factory.createBrokerCredentialCipher()
		);

		expect(error.message).toMatch(/openssl rand -hex 32/);
	});

	it('rejeita chave nao hexadecimal', () => {
		const factory = loadFactory('z'.repeat(64));

		expectErrorNamed('BrokerCipherKeyError', () =>
			factory.createBrokerCredentialCipher()
		);
	});

	it('rejeita chave legada com tamanho diferente de 32 bytes', () => {
		const factory = loadFactory(VALID_KEY_HEX, 'curta-demais');

		expectErrorNamed('BrokerCipherKeyError', () =>
			factory.createBrokerCredentialCipher()
		);
	});

	it('com chave valida, entrega uma cifra funcional em GCM', () => {
		const cipher = loadFactory(VALID_KEY_HEX).createBrokerCredentialCipher();

		expect(cipher.isEnabled()).toBe(true);
		expect(cipher.decrypt(cipher.encrypt('round-trip'))).toBe('round-trip');
	});
});
