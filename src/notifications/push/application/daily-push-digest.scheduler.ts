import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from 'src/users/schema/user.model';
import { Notification } from 'src/notifications/events/schema/notification.model';
import {
	NotificationChannelName,
	NotificationDeliveryStatus,
	NotificationPayload,
} from 'src/notifications/events/domain/notification.types';
import { NotificationsService } from 'src/notifications/events/application/notifications.service';
import { PushSubscriptionRepository } from '../infrastructure/push-subscription.repository';
import { buildPushDigest } from './push-digest.builder';
import { WEB_PUSH_SENDER, WebPushSender } from './ports/web-push-sender.port';

/**
 * Janela de coleta. Maior que as 24h da cadencia de proposito: se o cron
 * falhar um dia inteiro, o do dia seguinte ainda alcanca o que ficou para
 * tras em vez de perder as notificacoes em silencio.
 */
const LOOKBACK_HOURS = 36;

/**
 * Teto de candidatos por execucao. Com ~5 mil usuarios e poucos eventos
 * por usuario por dia, isto e folga de uma ordem de grandeza; existe para
 * que um bug rio acima (loop de producao de eventos) nao vire uma leitura
 * de milhoes de docs em memoria. Se o teto for atingido, o excedente entra
 * no resumo do dia seguinte — e o log avisa.
 */
const MAX_CANDIDATES_PER_RUN = 20_000;

type Candidate = {
	_id: Types.ObjectId;
	user: Types.ObjectId;
	payload: NotificationPayload;
};

/**
 * Disparo DIARIO e AGREGADO do Web Push (TRA-136, fase 6).
 *
 * Aqui mora a reconciliacao entre a porta `NotificationChannel`, que e
 * por-notificacao, e a cadencia de produto, que e uma por dia:
 *
 *   evento  ->  NotificationsService  ->  PushNotificationChannel
 *               (checa preferencia)       (aceita, marca `deferred`)
 *                        |
 *                        v
 *              Notification { deliveries: [push: deferred], pushDigestedAt: null }
 *                        |
 *   09:00 diario ->  ESTE scheduler: agrupa por usuario, monta UM payload,
 *                    envia para todas as assinaturas, marca pushDigestedAt
 *
 * O horario (09:00 America/Sao_Paulo) fica depois do
 * `portfolio-evaluation` (07:00) e do `subscription-expiring` (08:00), de
 * modo que o resumo do dia ja inclua o que esses dois produziram de manha.
 *
 * Falha por usuario e isolada: um endpoint fora do ar nao impede o resumo
 * dos demais.
 */
@Injectable()
export class DailyPushDigestScheduler {
	private readonly logger = new Logger(DailyPushDigestScheduler.name);

	constructor(
		@InjectModel('Notification')
		private readonly notificationModel: Model<Notification>,
		@InjectModel('User')
		private readonly userModel: Model<User>,
		private readonly subscriptions: PushSubscriptionRepository,
		private readonly notifications: NotificationsService,
		@Inject(WEB_PUSH_SENDER) private readonly sender: WebPushSender
	) {}

	@Cron('0 9 * * *', {
		name: 'notifications-daily-push-digest',
		timeZone: 'America/Sao_Paulo',
	})
	async runDaily(): Promise<void> {
		try {
			const summary = await this.dispatch(new Date());
			this.logger.log(
				`Push diario: ${summary.pushed} usuario(s) notificado(s), ` +
					`${summary.notifications} notificacao(oes) agregada(s), ` +
					`${summary.removedSubscriptions} assinatura(s) morta(s) removida(s).`
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(`Push diario falhou: ${message}`);
		}
	}

	/**
	 * Extraido do `@Cron` para poder ser testado com um `now` fixo. Nunca
	 * lanca por usuario.
	 */
	async dispatch(now: Date): Promise<{
		pushed: number;
		notifications: number;
		removedSubscriptions: number;
	}> {
		const candidates = await this.loadCandidates(now);
		if (candidates.length === 0) {
			return { pushed: 0, notifications: 0, removedSubscriptions: 0 };
		}

		const byUser = groupByUser(candidates);
		let pushed = 0;
		let removedSubscriptions = 0;

		for (const [userKey, group] of byUser) {
			try {
				const result = await this.dispatchForUser(userKey, group, now);
				if (result.pushed) pushed += 1;
				removedSubscriptions += result.removedSubscriptions;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				this.logger.error(
					`Push diario falhou para o usuario ${userKey}: ${message}`
				);
			} finally {
				// Marcado mesmo em caso de erro: o resumo e do DIA. Reprocessar
				// amanha entregaria "ontem" fora de hora, e a notificacao segue
				// visivel no centro in-app de qualquer forma.
				await this.markDigested(
					group.map((c) => c._id),
					now
				);
			}
		}

		return {
			pushed,
			notifications: candidates.length,
			removedSubscriptions,
		};
	}

	private async dispatchForUser(
		userKey: string,
		group: Candidate[],
		now: Date
	): Promise<{ pushed: boolean; removedSubscriptions: number }> {
		const user = await this.userModel
			.findById(new Types.ObjectId(userKey))
			.lean<User | null>();
		if (!user) return { pushed: false, removedSubscriptions: 0 };

		/**
		 * Preferencia reavaliada AGORA, e nao so no momento do evento.
		 *
		 * O canal ja checou quando aceitou, mas entre aquele instante e este
		 * pode ter passado um dia inteiro. Se o usuario desligou o aviso de
		 * dividendos as 15h, o resumo das 09h do dia seguinte nao pode
		 * carregar dividendos. A checagem no momento do envio e a unica que
		 * o usuario percebe como respeitada.
		 */
		const allowed = group
			.map((c) => c.payload)
			.filter((payload) =>
				this.notifications.userAllows(
					user,
					payload.type,
					NotificationChannelName.Push
				)
			);

		const digest = buildPushDigest(allowed, now);
		if (!digest) return { pushed: false, removedSubscriptions: 0 };

		if (!this.sender.isEnabled()) {
			// Sem VAPID nao ha o que enviar. Os docs seguem marcados no
			// `finally` do chamador para nao virarem backlog eterno.
			return { pushed: false, removedSubscriptions: 0 };
		}

		const targets = await this.subscriptions.findByUser(
			new Types.ObjectId(userKey)
		);
		if (targets.length === 0) return { pushed: false, removedSubscriptions: 0 };

		let delivered = 0;
		let removed = 0;

		for (const target of targets) {
			const result = await this.sender.send(
				{ endpoint: target.endpoint, keys: target.keys },
				digest
			);

			switch (result.outcome) {
				case 'sent':
					delivered += 1;
					await this.subscriptions.registerSuccess(target.endpoint);
					break;

				case 'expired':
					// 404/410: o endpoint nao existe mais. Apagar na hora e
					// obrigatorio — endpoint morto acumulado e o que degrada o
					// disparo diario em silencio conforme a base cresce.
					removed += await this.subscriptions.deleteByEndpoint(target.endpoint);
					this.logger.debug(
						`Assinatura removida (HTTP ${result.statusCode}) do usuario ${userKey}.`
					);
					break;

				case 'invalid':
				case 'transient':
					// Passageiro (429/5xx/rede) ou recusa pontual: conta e
					// mantem. Apagar aqui derrubaria a base inteira no primeiro
					// pico do provedor.
					await this.subscriptions.registerFailure(target.endpoint);
					break;

				case 'disabled':
					break;
			}
		}

		return { pushed: delivered > 0, removedSubscriptions: removed };
	}

	/**
	 * Candidatos = notificacoes que o canal push ACEITOU (`deferred`) e que
	 * ainda nao entraram em nenhum resumo.
	 */
	private async loadCandidates(now: Date): Promise<Candidate[]> {
		const since = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

		const docs = await this.notificationModel
			.find({
				pushDigestedAt: null,
				createdAt: { $gte: since },
				deliveries: {
					$elemMatch: {
						channel: NotificationChannelName.Push,
						status: NotificationDeliveryStatus.Deferred,
					},
				},
			})
			.select('user payload')
			.sort({ createdAt: 1 })
			.limit(MAX_CANDIDATES_PER_RUN)
			.lean<Candidate[]>();

		if (docs.length === MAX_CANDIDATES_PER_RUN) {
			this.logger.warn(
				`Push diario atingiu o teto de ${MAX_CANDIDATES_PER_RUN} candidatos; ` +
					'o excedente entra no resumo de amanha.'
			);
		}

		return docs;
	}

	private async markDigested(ids: Types.ObjectId[], now: Date): Promise<void> {
		if (ids.length === 0) return;
		await this.notificationModel.updateMany(
			{ _id: { $in: ids } },
			{ $set: { pushDigestedAt: now } }
		);
	}
}

function groupByUser(candidates: Candidate[]): Map<string, Candidate[]> {
	const grouped = new Map<string, Candidate[]>();
	for (const candidate of candidates) {
		const key = String(candidate.user);
		const bucket = grouped.get(key);
		if (bucket) bucket.push(candidate);
		else grouped.set(key, [candidate]);
	}
	return grouped;
}
