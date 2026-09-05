import { vapidPublicKey, vapidPrivateKey, vapidSubject } from 'src/env';

export type VapidConfig = {
	publicKey: string;
	privateKey: string;
	/** `mailto:` ou URL do responsavel, exigido pela RFC 8292. */
	subject: string;
};

const DEFAULT_SUBJECT = 'mailto:contato@trackerr.app';

/**
 * Le a configuracao VAPID do ambiente.
 *
 * Devolve `null` quando falta chave publica OU privada — as duas so fazem
 * sentido em par. O modulo trata `null` como "push desligado" e sobe
 * normalmente: uma chave ausente e um recurso indisponivel, nunca um boot
 * quebrado.
 *
 * O `subject` tem default porque, ao contrario das chaves, ele nao e
 * segredo: e so o contato que o push service usa para reclamar de abuso.
 */
export function readVapidConfig(): VapidConfig | null {
	const publicKey = (vapidPublicKey ?? '').trim();
	const privateKey = (vapidPrivateKey ?? '').trim();

	if (!publicKey || !privateKey) return null;

	return {
		publicKey,
		privateKey,
		subject: (vapidSubject ?? '').trim() || DEFAULT_SUBJECT,
	};
}
