import { Inject, Injectable } from '@nestjs/common';
import { canonicalize } from 'src/audit/domain/canonical-json';
import { AuditEventInput, hashPayload } from 'src/audit/domain/audit-event';
import { AuditTrail } from './audit-trail.port';
import { AUDIT_CLOCK } from './audit.tokens';
import {
	AUDIT_EVENT_STORE,
	AuditEventStore,
} from './ports/audit-event-store.port';

@Injectable()
export class AuditTrailService implements AuditTrail {
	constructor(
		@Inject(AUDIT_EVENT_STORE) private readonly store: AuditEventStore,
		@Inject(AUDIT_CLOCK) private readonly clock: () => Date
	) {}

	async record(event: AuditEventInput): Promise<void> {
		if (!event.eventId || !event.type || !event.subject || !event.actorRef) {
			// Evento sem identidade não tem como ser verificado depois.
			throw new Error(
				'Evento de auditoria sem eventId, type, subject ou actorRef'
			);
		}
		// O Mongo troca `undefined` por `null` e devolve datas como `Date`: o
		// conteúdo é gravado já na forma que volta do banco, para o hash
		// recalculado na verificação ser o mesmo e não virar falso alarme.
		// Antes, a forma canônica: recusa NaN, Infinity e afins, que o JSON
		// converteria em `null` sem avisar.
		canonicalize(event.payload);
		const payload = JSON.parse(JSON.stringify(event.payload)) as Record<
			string,
			unknown
		>;
		await this.store.insertPending({
			...event,
			payload,
			// Falha aqui (valor sem forma canônica) acontece ao gravar, quando
			// quem produz ainda pode reagir, e não ao selar.
			payloadHash: hashPayload(payload),
			seq: null,
			prevHash: null,
			hash: null,
			createdAt: this.clock(),
			sealedAt: null,
		});
	}
}
