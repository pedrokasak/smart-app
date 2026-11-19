import { createHmac } from 'crypto';
import { jwtSecret } from 'src/env';

function hmac(value: string): string {
	const secret = process.env.AUDIT_HMAC_SECRET || jwtSecret;
	return createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

/**
 * Pseudônimo estável de uma pessoa para a trilha (ADR-004, seção 8.5): HMAC
 * do id com segredo do servidor. Apagar o vínculo id → pessoa torna o
 * registro anônimo sem mexer na cadeia. `AUDIT_HMAC_SECRET` separa este
 * segredo do JWT quando definido.
 */
export function actorRefOf(userId: string): string {
	return 'usr_' + hmac(String(userId));
}

/**
 * Pseudônimo de um e-mail digitado num login que falhou: quem tentou entrar
 * pode não ter conta, então não há id. Normalizado para o mesmo e-mail
 * sempre dar o mesmo pseudônimo; o e-mail em si nunca entra na trilha.
 */
export function emailRefOf(email: string): string {
	return 'eml_' + hmac(String(email).trim().toLowerCase());
}
