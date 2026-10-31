import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { actorRefOf, emailRefOf } from 'src/audit/infrastructure/actor-ref';
import { SecurityEventType } from 'src/audit/domain/security-events';
import { AUDIT_TRAIL, AuditTrail } from './audit-trail.port';
import { AUDIT_CLOCK } from './audit.tokens';

/** Quem fez ou de quem se trata: uma conta, ou só um e-mail digitado. */
export type SecurityParty =
	| { userId: string }
	| { emailAttempted: string }
	| 'system';

export interface SecurityEventInput {
	type: SecurityEventType;
	actor: SecurityParty;
	/** Padrão: o próprio ator. Num papel alterado, é a conta alterada. */
	subject?: SecurityParty;
	payload?: Record<string, unknown>;
}

export const SECURITY_AUDIT = Symbol('SECURITY_AUDIT');

export interface SecurityAudit {
	/**
	 * Entrega o evento à trilha sem esperar e sem nunca lançar. Login e troca
	 * de senha não podem ficar mais lentos nem falhar por causa da auditoria,
	 * e o tempo de resposta de um login recusado não pode revelar se a conta
	 * existe (TRA-89).
	 */
	emit(event: SecurityEventInput): void;
}

function refOf(party: SecurityParty): string {
	if (party === 'system') return 'system';
	if ('userId' in party) return actorRefOf(party.userId);
	return emailRefOf(party.emailAttempted);
}

@Injectable()
export class SecurityAuditService implements SecurityAudit {
	private readonly logger = new Logger(SecurityAuditService.name);

	constructor(
		@Inject(AUDIT_TRAIL) private readonly trail: AuditTrail,
		@Inject(AUDIT_CLOCK) private readonly clock: () => Date
	) {}

	emit(event: SecurityEventInput): void {
		const eventId = randomUUID();
		const failed = (err: unknown) =>
			this.logger.error(
				`Trilha de auditoria: o evento ${event.type} (${eventId}) não foi gravado: ${(err as Error)?.message ?? err}`
			);
		try {
			const actorRef = refOf(event.actor);
			this.trail
				.record({
					eventId,
					type: event.type,
					version: 1,
					subject: event.subject ? refOf(event.subject) : actorRef,
					actorRef,
					occurredAt: this.clock(),
					payload: event.payload ?? {},
				})
				.catch(failed);
		} catch (err) {
			failed(err);
		}
	}
}
