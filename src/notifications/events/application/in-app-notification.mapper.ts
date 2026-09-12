import { InAppNotificationItem } from '../domain/in-app-notification.types';
import { NotificationPayload } from '../domain/notification.types';
import { Notification } from '../schema/notification.model';
import { buildTemplate } from '../channels/notification-templates';

/**
 * O doc de notificacao guarda o payload estruturado, nunca o texto pronto —
 * quem renderiza e `buildTemplate`, hoje usado pelo canal de e-mail. O
 * centro in-app reusa o mesmo registro em vez de persistir um `title`/`body`
 * novo: um campo persistido congelaria a copy no momento do disparo e
 * duplicaria a fonte da verdade (corrigir um texto exigiria backfill).
 *
 * Mapeamento:
 *   title  <- template.title
 *   body   <- template.description
 *   action <- { label: template.ctaLabel, route: template.ctaPath }
 *
 * TRA-136 fase 5: o resumo da IA entra como um CAMPO A MAIS (`aiSummary`),
 * nao substituindo `title`/`body`. Sobrescrever o corpo determinista com
 * texto de LLM trocaria a unica copy auditavel por uma gerada — e o corpo
 * e onde estao os numeros exatos. O resumo e persistido (nao regeravel a
 * cada leitura, ao contrario do template) porque a chamada e cara e o
 * texto precisa ser estavel entre duas aberturas da mesma lista.
 */
export function toInAppNotificationItem(
	doc: Notification
): InAppNotificationItem {
	const payload = doc.payload as unknown as NotificationPayload;
	const template = safeBuildTemplate(payload);

	const createdAt = doc.createdAt ?? doc._id?.getTimestamp() ?? new Date();

	const item: InAppNotificationItem = {
		id: doc._id?.toString() ?? '',
		type: doc.type,
		title: template?.title ?? doc.type,
		body: template?.description ?? '',
		createdAt: createdAt.toISOString(),
		readAt: doc.readAt ? new Date(doc.readAt).toISOString() : null,
	};

	const aiSummary =
		typeof doc.aiSummary === 'string' ? doc.aiSummary.trim() : '';
	if (aiSummary) {
		item.aiSummary = aiSummary;
	}

	if (template?.ctaLabel && template?.ctaPath) {
		item.action = { label: template.ctaLabel, route: template.ctaPath };
	}

	return item;
}

/**
 * `buildTemplate` e um switch exaustivo sobre a uniao de payloads. Um doc
 * gravado por uma versao anterior (ou com payload corrompido) cai fora da
 * uniao e devolveria `undefined` em runtime — a lista inteira nao pode
 * quebrar por causa de um item.
 */
function safeBuildTemplate(payload: NotificationPayload) {
	try {
		return buildTemplate(payload) ?? null;
	} catch {
		return null;
	}
}
