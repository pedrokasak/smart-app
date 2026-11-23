import { randomUUID } from 'crypto';
import type { AuditEventInput } from 'src/audit/domain/audit-event';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import type { AccessContext } from '../authorization.service';

export const ALERTS_VIEWED_EVENT = 'advisor.alerts.viewed';

/** O evento de leitura de fila ou painel: só ids, nunca valores nem nomes. */
export function alertsViewedEvent(
	ctx: AccessContext,
	clientIds: string[]
): AuditEventInput {
	return {
		eventId: randomUUID(),
		type: ALERTS_VIEWED_EVENT,
		version: 1,
		subject: ctx.orgId,
		actorRef: actorRefOf(ctx.userId),
		occurredAt: new Date(),
		payload: { orgId: ctx.orgId, clientIds: [...new Set(clientIds)] },
	};
}
