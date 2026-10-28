import { createHmac } from 'crypto';
import { jwtSecret } from 'src/env';

/**
 * Pseudônimo estável do admin para o histórico (ADR-004, seção 8.5): HMAC do
 * id com segredo do servidor. Apagar o vínculo id → pessoa torna o registro
 * anônimo sem mexer no histórico. `AUDIT_HMAC_SECRET` separa este segredo do
 * JWT quando definido.
 */
export function actorRefOf(userId: string): string {
	const secret = process.env.AUDIT_HMAC_SECRET || jwtSecret;
	return (
		'usr_' +
		createHmac('sha256', secret)
			.update(String(userId))
			.digest('hex')
			.slice(0, 32)
	);
}
