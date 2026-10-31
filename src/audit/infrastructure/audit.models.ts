import { Schema, model } from 'mongoose';
import { StoredAuditEvent } from 'src/audit/domain/audit-event';

/**
 * `audit_events`: a trilha. Um documento por evento; o selo (`seq`, `prevHash`,
 * `hash`, `sealedAt`) é escrito uma vez. Em produção, o usuário do Mongo desta
 * coleção deve ter só `insert`, `find` e o `update` do selo (ADR-004, 9.3).
 */
const auditEventSchema = new Schema<StoredAuditEvent>(
	{
		eventId: { type: String, required: true },
		type: { type: String, required: true },
		version: { type: Number, required: true },
		subject: { type: String, required: true },
		actorRef: { type: String, required: true },
		occurredAt: { type: Date, required: true },
		payload: { type: Schema.Types.Mixed, required: true },
		payloadHash: { type: String, required: true },
		seq: { type: Number, default: null },
		prevHash: { type: String, default: null },
		hash: { type: String, default: null },
		createdAt: { type: Date, required: true },
		sealedAt: { type: Date, default: null },
	},
	{ collection: 'audit_events', minimize: false, versionKey: false }
);

auditEventSchema.index(
	{ eventId: 1 },
	{ unique: true, name: 'audit_event_id' }
);
// A numeração é única só entre os selados: pendente tem `seq` nulo.
auditEventSchema.index(
	{ seq: 1 },
	{
		unique: true,
		name: 'audit_event_seq',
		partialFilterExpression: { seq: { $type: 'number' } },
	}
);
auditEventSchema.index(
	{ seq: 1, createdAt: 1 },
	{ name: 'audit_event_pending' }
);
auditEventSchema.index(
	{ subject: 1, occurredAt: -1 },
	{ name: 'audit_event_subject' }
);

export const AuditEventModel = model<StoredAuditEvent>(
	'AuditEvent',
	auditEventSchema
);

export interface AuditChainDoc {
	_id: string;
	seq: number;
	hash: string;
	leaseOwner: string | null;
	leaseUntil: Date | null;
}

/**
 * `audit_chain`: um único documento (`_id: 'head'`) com o ponteiro da cadeia e a
 * concessão do selador.
 */
const auditChainSchema = new Schema<AuditChainDoc>(
	{
		_id: { type: String, required: true },
		seq: { type: Number, required: true },
		hash: { type: String, required: true },
		leaseOwner: { type: String, default: null },
		leaseUntil: { type: Date, default: null },
	},
	{ collection: 'audit_chain', versionKey: false, _id: false }
);

export const AuditChainModel = model<AuditChainDoc>(
	'AuditChain',
	auditChainSchema
);
