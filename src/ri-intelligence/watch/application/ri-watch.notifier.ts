import { Inject, Injectable, Logger } from '@nestjs/common';
import {
	EVENT_PUBLISHER,
	EventPublisher,
} from 'src/events/application/ports/event-publisher.port';
import { deterministicEventId } from 'src/events/domain/deterministic-event-id';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import {
	isMaterialFactFiling,
	RiWatchDocument,
	RiWatchNotificationSnapshot,
} from 'src/ri-intelligence/watch/domain/ri-watch';
import {
	RI_HOLDER_DIRECTORY,
	RiHolderDirectory,
} from './ports/ri-holder-directory.port';
import {
	RI_SUMMARY_ENTITLEMENT,
	RiSummaryEntitlement,
} from './ports/ri-summary-entitlement.port';
import { RI_WATCH_STORE, RiWatchStore } from './ports/ri-watch-store.port';
import { RI_WATCH_CONFIG, RiWatchConfig } from './ri-watch.config';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Documentos avisados por rodada: limita o trabalho de uma rodada. */
const NOTIFY_BATCH = 50;

/**
 * Quanto o aviso espera pelo resumo. As rodadas ficam de 5h a 13h uma da
 * outra (7h, 12h, 18h): com 4h, o documento que nao coube no teto de
 * resumos da sua rodada sai na seguinte, sem os destaques. Sem esta espera
 * maxima, uma fila de resumos (temporada de balancos) segurava o aviso ate
 * ele passar da idade maxima — e ninguem era avisado.
 */
const SUMMARY_WAIT_MS = 4 * 60 * 60 * 1000;

/** Destaques no aviso: o bastante para o e-mail, sem virar o resumo todo. */
const MAX_HIGHLIGHTS = 3;

const PRODUCER = 'server.ri-intelligence.watch';

export interface RiWatchNotifyResult {
	/** Documentos que sairam da fila de aviso nesta rodada. */
	documents: number;
	/** Eventos publicados (um por detentor por documento). */
	events: number;
	/** Documentos encerrados sem aviso (velhos, ou sem detentor). */
	skipped: number;
	/** Documentos que falharam e ficam para a proxima rodada. */
	failed: number;
}

/**
 * Vigia de RI, etapa C (TRA-261): avisar quem tem o papel.
 *
 * Nao notifica ninguem diretamente: publica `ri.material_fact.published` ou
 * `ri.document.published`, UM POR DETENTOR, no barramento de eventos
 * (TRA-136). Preferencia por canal, chave geral de e-mail, dedupe, push
 * diario e centro in-app ficam com quem ja faz isso para os outros avisos.
 *
 * Decisoes:
 * - Avisa documento com processamento TERMINADO (resumido, ignorado ou
 *   esgotado) — com resumo quando houver, sem ele quando o PDF nao deixou —
 *   ou que espera o resumo ha mais de uma rodada (`SUMMARY_WAIT_MS`): o
 *   teto de custo da IA nao pode atrasar o aviso.
 * - Idempotente: o id do evento sai de (tipo, usuario, documento). Rodar de
 *   novo — falha no meio, duas instancias — cai no dedupe da fila e do
 *   `NotificationsService`, nunca em aviso duplicado.
 * - Documento mais velho que `notifyMaxAgeDays` sai da fila sem aviso.
 * - Destaques da IA so para quem tem `ri.ai_summary`; o payload fica gravado
 *   na notificacao, entao e aqui que se decide o que cada um le.
 *
 * Nunca lanca: roda em cron, e um documento problematico nao pode segurar
 * os outros. O que falha fica na fila e volta na rodada seguinte.
 */
@Injectable()
export class RiWatchNotifier {
	private readonly logger = new Logger(RiWatchNotifier.name);

	constructor(
		@Inject(RI_WATCH_STORE) private readonly store: RiWatchStore,
		@Inject(RI_HOLDER_DIRECTORY) private readonly holders: RiHolderDirectory,
		@Inject(RI_SUMMARY_ENTITLEMENT)
		private readonly entitlement: RiSummaryEntitlement,
		@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
		@Inject(RI_WATCH_CONFIG) private readonly config: RiWatchConfig
	) {}

	async notifyProcessed(now: Date = new Date()): Promise<RiWatchNotifyResult> {
		const result: RiWatchNotifyResult = {
			documents: 0,
			events: 0,
			skipped: 0,
			failed: 0,
		};
		if (!this.config.notifyEnabled) return result;

		const docs = await this.store.findUnnotified(
			NOTIFY_BATCH,
			new Date(now.getTime() - SUMMARY_WAIT_MS)
		);
		for (const doc of docs) {
			try {
				const outcome = await this.notifyOne(doc, now);
				result.documents += 1;
				result.events += outcome.holders;
				if (outcome.skippedReason) result.skipped += 1;
			} catch (err) {
				result.failed += 1;
				this.logger.warn(
					`Vigia de RI: aviso do documento ${doc.key} falhou: ${this.messageOf(err)}`
				);
			}
		}
		return result;
	}

	private async notifyOne(
		doc: RiWatchDocument,
		now: Date
	): Promise<RiWatchNotificationSnapshot> {
		const ageMs = now.getTime() - new Date(doc.publishedAt).getTime();
		if (ageMs > this.config.notifyMaxAgeDays * DAY_MS) {
			return this.close(doc, { holders: 0, skippedReason: 'too_old' }, now);
		}

		const holders = await this.holders.holdersOfIssuer(doc.ticker);
		if (!holders.length) {
			return this.close(doc, { holders: 0, skippedReason: 'no_holders' }, now);
		}

		const highlights = (doc.summary?.highlights ?? []).slice(0, MAX_HIGHLIGHTS);
		const entitled = highlights.length
			? await this.entitlement.usersWithAiSummary(
					holders.map((holder) => holder.userId)
				)
			: new Set<string>();
		const type = isMaterialFactFiling(doc.record)
			? DOMAIN_EVENT_TYPES.RiMaterialFactPublished
			: DOMAIN_EVENT_TYPES.RiDocumentPublished;

		for (const holder of holders) {
			await this.publisher.publish(
				createDomainEvent({
					id: deterministicEventId(type, holder.userId, doc.key),
					type,
					subject: holder.userId,
					producer: PRODUCER,
					occurredAt: doc.publishedAt,
					payload: {
						ticker: holder.ticker,
						// Sem nome da empresa o aviso seria recusado no caminho
						// (payload incompleto) — para todos os detentores.
						company: doc.record.company?.trim() || holder.ticker,
						title: doc.record.title,
						publishedAt: doc.publishedAt,
						sourceUrl: doc.record.source.value,
						...(entitled.has(holder.userId) ? { highlights } : {}),
					},
				})
			);
		}

		return this.close(
			doc,
			{ holders: holders.length, skippedReason: null },
			now
		);
	}

	private async close(
		doc: RiWatchDocument,
		notification: RiWatchNotificationSnapshot,
		now: Date
	): Promise<RiWatchNotificationSnapshot> {
		await this.store.markNotified(doc.key, notification, now);
		return notification;
	}

	private messageOf(err: unknown): string {
		return err instanceof Error ? err.message : String(err);
	}
}
