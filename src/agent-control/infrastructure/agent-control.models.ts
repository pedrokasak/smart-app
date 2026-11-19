import { Schema, model } from 'mongoose';
import {
	AgentControl,
	AgentControlChange,
} from 'src/agent-control/domain/agent-control.types';
import {
	AgentRun,
	RUN_RETENTION_DAYS,
} from 'src/agent-control/domain/agent-run.types';

/**
 * `agent_controls`: um documento por agente controlável (ADR-005, seção 4).
 * `version` é o controle otimista; o índice único em `agentId` fecha a
 * corrida do seed entre duas instâncias subindo juntas.
 */
const agentControlSchema = new Schema<AgentControl>(
	{
		agentId: { type: String, required: true },
		enabled: { type: Boolean, required: true },
		config: { type: Schema.Types.Mixed, default: {} },
		pausedUntil: { type: Date, default: null },
		version: { type: Number, required: true, default: 1 },
		updatedBy: { type: String, required: true },
		updatedAt: { type: Date, required: true },
		reason: { type: String, default: null },
	},
	{ collection: 'agent_controls', minimize: false, versionKey: false }
);

agentControlSchema.index(
	{ agentId: 1 },
	{ unique: true, name: 'agent_control_id' }
);

export const AgentControlModel = model<AgentControl>(
	'AgentControl',
	agentControlSchema
);

/**
 * `agent_control_changes`: histórico só de inclusão. O adaptador nunca
 * atualiza nem apaga; o selo na trilha encadeada chega na fase A4.
 * `actorRef` é HMAC do id do admin, nunca o e-mail.
 */
const agentControlChangeSchema = new Schema<AgentControlChange>(
	{
		agentId: { type: String, required: true },
		fromVersion: { type: Number, required: true },
		toVersion: { type: Number, required: true },
		before: { type: Schema.Types.Mixed, required: true },
		after: { type: Schema.Types.Mixed, required: true },
		actorRef: { type: String, required: true },
		reason: { type: String, default: null },
		ip: { type: String, default: null },
		at: { type: Date, required: true },
		auditEventId: { type: String, default: null },
	},
	{ collection: 'agent_control_changes', minimize: false, versionKey: false }
);

agentControlChangeSchema.index(
	{ agentId: 1, at: -1 },
	{ name: 'agent_change_by_agent' }
);
agentControlChangeSchema.index({ at: -1 }, { name: 'agent_change_recent' });

export const AgentControlChangeModel = model<AgentControlChange>(
	'AgentControlChange',
	agentControlChangeSchema
);

/**
 * `agent_runs`: uma linha por rodada de agente (ADR-005, fase A3). Só
 * inclusão. Sai sozinha depois de 180 dias (índice TTL em `finishedAt`).
 */
const agentRunSchema = new Schema<AgentRun>(
	{
		agentId: { type: String, required: true },
		startedAt: { type: Date, required: true },
		finishedAt: { type: Date, required: true },
		status: {
			type: String,
			required: true,
			enum: ['ok', 'partial', 'failed', 'skipped_disabled'],
		},
		items: { type: Number, default: 0 },
		errors: { type: Number, default: 0 },
		tokens: { type: Number, default: 0 },
		costBrl: { type: Number, default: null },
		error: { type: String, default: null },
	},
	{ collection: 'agent_runs', minimize: false, versionKey: false }
);

agentRunSchema.index(
	{ finishedAt: 1 },
	{
		expireAfterSeconds: RUN_RETENTION_DAYS * 24 * 60 * 60,
		name: 'agent_run_ttl',
	}
);
agentRunSchema.index(
	{ agentId: 1, finishedAt: -1 },
	{ name: 'agent_run_by_agent' }
);

export const AgentRunModel = model<AgentRun>('AgentRun', agentRunSchema);
