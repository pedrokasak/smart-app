import {
	PushDeliveryResult,
	PushTarget,
	WebPushPayload,
} from '../../domain/push.types';

/**
 * Porta de saida do Web Push.
 *
 * Existe para que a biblioteca `web-push` (e o protocolo VAPID) fiquem
 * confinados em `infrastructure/`. Trocar de provedor — ou passar a
 * entregar via um gateway proprio quando o produto crescer — e escrever
 * outro adaptador, sem tocar no agregador diario nem no scheduler.
 *
 * `architecture.spec.ts` transforma isso em regra mecanica: nenhum arquivo
 * em `application/` ou `domain/` pode importar `web-push`.
 */
export interface WebPushSender {
	/** false quando as chaves VAPID nao foram configuradas. */
	isEnabled(): boolean;

	/**
	 * Chave publica VAPID em base64url, servida ao navegador. String vazia
	 * quando o push esta desligado — o front trata como "indisponivel" em
	 * vez de receber um erro.
	 */
	publicKey(): string;

	send(
		target: PushTarget,
		payload: WebPushPayload
	): Promise<PushDeliveryResult>;
}

export const WEB_PUSH_SENDER = Symbol('WEB_PUSH_SENDER');
