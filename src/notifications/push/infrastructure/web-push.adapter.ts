import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { WebPushSender } from '../application/ports/web-push-sender.port';
import {
	MAX_PUSH_PAYLOAD_PLAINTEXT_BYTES,
	PushDeliveryResult,
	PushTarget,
	WebPushPayload,
} from '../domain/push.types';
import { VapidConfig } from './vapid.config';

/**
 * Tempo que o push service guarda a mensagem enquanto o aparelho esta
 * offline. 23h e menos que a cadencia diaria de proposito: se o usuario
 * so ligar o celular depois disso, o resumo de hoje ja teria virado o de
 * ontem e chegariam dois avisos concorrentes.
 */
const TTL_SECONDS = 23 * 60 * 60;

/**
 * Codigos que significam "este endpoint morreu, para sempre". 404 = o push
 * service nao conhece mais a assinatura; 410 Gone = ela foi revogada
 * (usuario limpou dados do site, desinstalou o PWA, negou a permissao).
 * Qualquer outro codigo NAO apaga nada.
 */
const DEAD_ENDPOINT_STATUS = new Set([404, 410]);

/**
 * Codigos que indicam problema do nosso lado (payload grande demais,
 * assinatura malformada, VAPID recusado). Nao adianta repetir igual, mas
 * tambem nao e motivo para apagar a assinatura do usuario.
 */
const PERMANENT_CLIENT_STATUS = new Set([400, 401, 403, 413]);

/**
 * Unico arquivo do projeto que importa `web-push`.
 *
 * Traduz a biblioteca para a linguagem da porta: entra um alvo e um
 * payload, sai um `PushDeliveryResult` ja classificado entre morte
 * permanente e falha passageira. Quem chama nunca ve `WebPushError` nem
 * codigo HTTP para decidir.
 */
@Injectable()
export class WebPushAdapter implements WebPushSender {
	private readonly logger = new Logger(WebPushAdapter.name);

	constructor(private readonly config: VapidConfig) {}

	isEnabled(): boolean {
		return true;
	}

	publicKey(): string {
		return this.config.publicKey;
	}

	async send(
		target: PushTarget,
		payload: WebPushPayload
	): Promise<PushDeliveryResult> {
		const body = JSON.stringify(payload);
		const bytes = Buffer.byteLength(body, 'utf8');
		if (bytes > MAX_PUSH_PAYLOAD_PLAINTEXT_BYTES) {
			// Barrado aqui e nao no push service: um 413 remoto custa uma
			// viagem de rede e vem sem explicacao util.
			return {
				outcome: 'invalid',
				statusCode: 413,
				error: `payload de ${bytes}B acima do teto de ${MAX_PUSH_PAYLOAD_PLAINTEXT_BYTES}B`,
			};
		}

		try {
			await webpush.sendNotification(
				{
					endpoint: target.endpoint,
					keys: { p256dh: target.keys.p256dh, auth: target.keys.auth },
				},
				body,
				{
					TTL: TTL_SECONDS,
					urgency: 'normal',
					// Passado por chamada em vez de `setVapidDetails()` global:
					// estado de modulo compartilhado nao sobrevive a testes em
					// paralelo nem a uma eventual rotacao de chave em runtime.
					vapidDetails: {
						subject: this.config.subject,
						publicKey: this.config.publicKey,
						privateKey: this.config.privateKey,
					},
				}
			);
			return { outcome: 'sent' };
		} catch (err) {
			return this.classify(err);
		}
	}

	/**
	 * `web-push` lanca `WebPushError` (com `statusCode`) para resposta HTTP
	 * e um Error comum para falha de rede/DNS/timeout. Falha de rede e
	 * sempre passageira.
	 */
	private classify(err: unknown): PushDeliveryResult {
		const statusCode =
			typeof (err as { statusCode?: unknown })?.statusCode === 'number'
				? ((err as { statusCode: number }).statusCode as number)
				: undefined;

		// Nunca inclui o corpo da assinatura na mensagem: o `endpoint` ja
		// identifica o alvo e as chaves nao passam por aqui.
		const message = err instanceof Error ? err.message : String(err);

		if (statusCode !== undefined && DEAD_ENDPOINT_STATUS.has(statusCode)) {
			return { outcome: 'expired', statusCode };
		}

		if (statusCode !== undefined && PERMANENT_CLIENT_STATUS.has(statusCode)) {
			this.logger.warn(`Web Push recusou o envio (HTTP ${statusCode}).`);
			return { outcome: 'invalid', statusCode, error: message };
		}

		return { outcome: 'transient', error: message, statusCode };
	}
}
