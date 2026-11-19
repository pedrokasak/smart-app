import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { StoredAuditEvent } from 'src/audit/domain/audit-event';
import {
	AUDIT_EVENT_STORE,
	AuditEventListQuery,
	AuditEventStore,
} from './ports/audit-event-store.port';

export const AUDIT_LIST_MAX = 100;
export const AUDIT_LIST_DEFAULT = 50;

/**
 * Só metadados. O conteúdo do evento (`payload`) não sai daqui: a tela de
 * auditoria precisa saber que algo aconteceu e se continua íntegro, não rever
 * dados (ADR-004, seção 8.5).
 */
export interface AuditEventSummary {
	eventId: string;
	type: string;
	subject: string;
	actorRef: string;
	occurredAt: string;
	/** `null` enquanto o selador não numerou o evento. */
	seq: number | null;
	hash: string | null;
	sealed: boolean;
}

export interface AuditEventPage {
	items: AuditEventSummary[];
	nextCursor: string | null;
}

function encodeCursor(event: StoredAuditEvent): string {
	return Buffer.from(
		`${event.createdAt.toISOString()}|${event.eventId}`,
		'utf8'
	).toString('base64url');
}

function decodeCursor(cursor: string): AuditEventListQuery['before'] {
	const [at, ...rest] = Buffer.from(cursor, 'base64url')
		.toString('utf8')
		.split('|');
	const eventId = rest.join('|');
	const createdAt = new Date(at);
	if (!eventId || Number.isNaN(createdAt.getTime())) {
		throw new BadRequestException('Cursor inválido');
	}
	return { createdAt, eventId };
}

@Injectable()
export class AuditListService {
	constructor(
		@Inject(AUDIT_EVENT_STORE) private readonly store: AuditEventStore
	) {}

	async list(options: {
		type?: string;
		subject?: string;
		limit?: number;
		cursor?: string;
	}): Promise<AuditEventPage> {
		const limit = Math.min(
			Math.max(1, options.limit ?? AUDIT_LIST_DEFAULT),
			AUDIT_LIST_MAX
		);
		const rows = await this.store.list(
			{
				type: options.type,
				subject: options.subject,
				before: options.cursor ? decodeCursor(options.cursor) : undefined,
			},
			limit + 1
		);
		const page = rows.slice(0, limit);
		return {
			items: page.map((event) => ({
				eventId: event.eventId,
				type: event.type,
				subject: event.subject,
				actorRef: event.actorRef,
				occurredAt: event.occurredAt.toISOString(),
				seq: event.seq,
				hash: event.hash,
				sealed: event.seq !== null,
			})),
			nextCursor:
				rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
		};
	}
}
