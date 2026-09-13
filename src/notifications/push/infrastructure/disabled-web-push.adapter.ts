import { Injectable, Logger } from '@nestjs/common';
import { WebPushSender } from '../application/ports/web-push-sender.port';
import { PushDeliveryResult } from '../domain/push.types';

/**
 * Implementacao da porta WebPushSender para quando VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY nao estao configuradas.
 *
 * Mesmo padrao do `DisabledEventQueueAdapter` (TRA-136, fase 3): null
 * object em vez de `undefined` espalhado por `if`. O scheduler continua
 * rodando, a rota da chave publica continua respondendo 200 com string
 * vazia e o registro de assinatura continua aceito — nada 500 por falta de
 * uma variavel de ambiente.
 *
 * O aviso sai UMA vez, na construcao. Repetir a cada disparo diario
 * transformaria uma configuracao ausente em ruido de log permanente.
 */
@Injectable()
export class DisabledWebPushAdapter implements WebPushSender {
	private readonly logger = new Logger(DisabledWebPushAdapter.name);

	constructor() {
		this.logger.warn(
			'Web Push desligado: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes. ' +
				'As rotas de assinatura seguem no ar e nenhum push sera enviado.'
		);
	}

	isEnabled(): boolean {
		return false;
	}

	publicKey(): string {
		return '';
	}

	// Os parametros da porta sao omitidos de proposito: o null object ignora
	// alvo e conteudo, e a assinatura continua compativel com WebPushSender.
	async send(): Promise<PushDeliveryResult> {
		return { outcome: 'disabled' };
	}
}
