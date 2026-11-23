import { randomUUID } from 'crypto';
import { Schema } from 'mongoose';
import { AlertSettings } from '../domain/alert-settings';
import {
	AlertHandledVia,
	AlertPriority,
	AlertRule,
	AlertStatus,
	PortfolioProvenance,
	SnapshotSource,
} from '../domain/enums';

/**
 * Read model do motor de atenção (P3b). Mesmas regras do restante do módulo:
 * `_id` string (uuid), sem `ref` para coleções de outros módulos. Dinheiro em
 * centavos inteiros (BRL). As cinco coleções são apagadas por cliente
 * quando o vínculo acaba ou a conta é excluída (ver
 * `MODULE_ERASED_COLLECTIONS`).
 */
export const ADVISOR_CLIENT_SNAPSHOT_MODEL = 'AdvisorClientSnapshot';
export const ADVISOR_WEALTH_DAILY_MODEL = 'AdvisorWealthDaily';
export const ADVISOR_ALERT_MODEL = 'AdvisorAlert';
export const ADVISOR_ALERT_SETTINGS_MODEL = 'AdvisorAlertSettings';
export const ADVISOR_CLIENT_CONTACT_MODEL = 'AdvisorClientContact';

/** A série diária expira 400 dias depois de criada. */
export const WEALTH_DAILY_TTL_SECONDS = 400 * 24 * 60 * 60;

export const CLIENT_SNAPSHOT_CLIENT_INDEX = 'advisor_client_snapshot_client';
export const WEALTH_DAILY_UNIQUE_INDEX = 'advisor_wealth_daily_unique';
export const WEALTH_DAILY_ORG_DATE_INDEX = 'advisor_wealth_daily_org_date';
export const WEALTH_DAILY_TTL_INDEX = 'advisor_wealth_daily_ttl';
/** Uma condição ativa (OPEN/SNOOZED) por cliente; conferido no erro 11000. */
export const ALERT_ACTIVE_CONDITION_INDEX = 'advisor_alert_active_condition';
export const ALERT_CLIENT_INDEX = 'advisor_alert_client';
export const ALERT_QUEUE_INDEX = 'advisor_alert_queue';
export const ALERT_SETTINGS_ORG_INDEX = 'advisor_alert_settings_org';
export const CLIENT_CONTACT_CLIENT_INDEX = 'advisor_client_contact_client';

export interface AdvisorClientSnapshotDoc {
	_id: string;
	orgId: string;
	clientProfileId: string;
	asOf: string;
	/** `SourceSnapshot[]`; as métricas são um objeto livre, sem schema fundo. */
	sources: unknown[];
	totalMinor: number;
	verifiedMinor: number;
	manualMinor: number;
	relationshipStartedAt: Date;
	lastContactAt?: Date | null;
	computedAt: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface AdvisorWealthDailyDoc {
	_id: string;
	orgId: string;
	clientProfileId: string;
	date: string;
	source: SnapshotSource;
	/** Vazio no livro do assessor (a chave única não aceita ausência). */
	portfolioId: string;
	totalMinor: number;
	verifiedMinor: number;
	manualMinor: number;
	createdAt: Date;
}

export interface AdvisorAlertDoc {
	_id: string;
	orgId: string;
	clientProfileId: string;
	rule: AlertRule;
	source?: SnapshotSource | null;
	key: string;
	conditionKey: string;
	band: 1 | 2;
	priority: AlertPriority;
	/** Derivado de `priority` (P0=0 ... P3=3); grava em todo insert e patch. */
	priorityRank: number;
	messageKey: string;
	params: Record<string, string | number>;
	evidence: Record<string, string | number | null>;
	dataAsOf: string;
	provenance?: PortfolioProvenance | null;
	lowConfidence: boolean;
	status: AlertStatus;
	/**
	 * `true` em OPEN/SNOOZED. Existe só para o índice único parcial (o Mongo
	 * não aceita `$in` no filtro em todas as versões).
	 */
	active: boolean;
	createdByUserId?: string;
	title?: string;
	note?: string;
	dueDate?: string;
	snoozedUntil?: string;
	handledVia?: AlertHandledVia;
	handledByUserId?: string;
	dismissReason?: string;
	closedAt?: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface AdvisorAlertSettingsDoc {
	_id: string;
	orgId: string;
	/** Ausente até o primeiro `upsertSettings`; vale o padrão. */
	settings?: AlertSettings;
	engineEnabledAt: Date;
	updatedByUserId?: string;
	/** Só muda em `upsertSettings` (por isso o schema não usa timestamp). */
	updatedAt?: Date;
	createdAt: Date;
}

export interface AdvisorClientContactDoc {
	_id: string;
	orgId: string;
	clientProfileId: string;
	lastContactAt: Date;
	recordedByUserId: string;
	createdAt: Date;
	updatedAt: Date;
}

const id = {
	type: String,
	default: (): string => randomUUID(),
};

const baseOptions = {
	versionKey: false,
	timestamps: true,
	minimize: false,
} as const;

const isInteger = {
	validator: (value: number): boolean => Number.isInteger(value),
	message: '{PATH} must be an integer',
};

const isoDate = { type: String, match: /^\d{4}-\d{2}-\d{2}$/ };

const clientSnapshotSchema = new Schema<AdvisorClientSnapshotDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		clientProfileId: { type: String, required: true },
		asOf: { ...isoDate, required: true },
		sources: { type: Schema.Types.Mixed, required: true },
		totalMinor: { type: Number, required: true, validate: isInteger },
		verifiedMinor: { type: Number, required: true, validate: isInteger },
		manualMinor: { type: Number, required: true, validate: isInteger },
		relationshipStartedAt: { type: Date, required: true },
		lastContactAt: { type: Date, default: null },
		computedAt: { type: Date, required: true },
	},
	{ ...baseOptions, collection: 'advisor_client_snapshots' }
);
clientSnapshotSchema.index(
	{ orgId: 1, clientProfileId: 1 },
	{ unique: true, name: CLIENT_SNAPSHOT_CLIENT_INDEX }
);

const wealthDailySchema = new Schema<AdvisorWealthDailyDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		clientProfileId: { type: String, required: true },
		date: { ...isoDate, required: true },
		source: {
			type: String,
			enum: Object.values(SnapshotSource),
			required: true,
		},
		portfolioId: { type: String, default: '' },
		totalMinor: { type: Number, required: true, validate: isInteger },
		verifiedMinor: { type: Number, required: true, validate: isInteger },
		manualMinor: { type: Number, required: true, validate: isInteger },
	},
	{
		...baseOptions,
		timestamps: { createdAt: true, updatedAt: false },
		collection: 'advisor_wealth_daily',
	}
);
wealthDailySchema.index(
	{ orgId: 1, clientProfileId: 1, date: 1, source: 1, portfolioId: 1 },
	{ unique: true, name: WEALTH_DAILY_UNIQUE_INDEX }
);
// `sumByDate` e `clientIdsOn`: a faixa de datas da organização.
wealthDailySchema.index(
	{ orgId: 1, date: 1, clientProfileId: 1 },
	{ name: WEALTH_DAILY_ORG_DATE_INDEX }
);
wealthDailySchema.index(
	{ createdAt: 1 },
	{ expireAfterSeconds: WEALTH_DAILY_TTL_SECONDS, name: WEALTH_DAILY_TTL_INDEX }
);

const nullableEnum = <T extends string>(values: T[]) => ({
	type: String,
	enum: [...values, null],
	default: null,
});

const alertSchema = new Schema<AdvisorAlertDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		clientProfileId: { type: String, required: true },
		rule: { type: String, enum: Object.values(AlertRule), required: true },
		source: nullableEnum(Object.values(SnapshotSource)),
		key: { type: String, required: true },
		conditionKey: { type: String, required: true },
		band: { type: Number, enum: [1, 2], required: true },
		priority: {
			type: String,
			enum: Object.values(AlertPriority),
			required: true,
		},
		priorityRank: {
			type: Number,
			required: true,
			min: 0,
			max: 3,
			validate: isInteger,
		},
		messageKey: { type: String, required: true },
		params: { type: Schema.Types.Mixed, required: true },
		evidence: { type: Schema.Types.Mixed, required: true },
		dataAsOf: { ...isoDate, required: true },
		provenance: nullableEnum(Object.values(PortfolioProvenance)),
		lowConfidence: { type: Boolean, required: true },
		status: {
			type: String,
			enum: Object.values(AlertStatus),
			required: true,
		},
		active: { type: Boolean, required: true },
		createdByUserId: { type: String },
		title: { type: String },
		note: { type: String },
		dueDate: isoDate,
		snoozedUntil: isoDate,
		handledVia: { type: String, enum: Object.values(AlertHandledVia) },
		handledByUserId: { type: String },
		dismissReason: { type: String },
		closedAt: { type: Date },
	},
	{ ...baseOptions, collection: 'advisor_alerts' }
);
// No máximo um alerta ativo por condição e cliente; fechado libera a chave.
alertSchema.index(
	{ orgId: 1, clientProfileId: 1, conditionKey: 1 },
	{
		unique: true,
		name: ALERT_ACTIVE_CONDITION_INDEX,
		partialFilterExpression: { active: true },
	}
);
// A fila: status e prioridade da organização, do mais grave ao mais novo.
// `listForClient` e `deleteByClient`: os alertas de um cliente.
alertSchema.index(
	{ orgId: 1, clientProfileId: 1, createdAt: 1 },
	{ name: ALERT_CLIENT_INDEX }
);
alertSchema.index(
	{ orgId: 1, status: 1, priorityRank: 1, createdAt: 1 },
	{ name: ALERT_QUEUE_INDEX }
);

const alertSettingsSchema = new Schema<AdvisorAlertSettingsDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		settings: { type: Schema.Types.Mixed },
		engineEnabledAt: { type: Date, required: true },
		updatedByUserId: { type: String },
		updatedAt: { type: Date },
	},
	{
		...baseOptions,
		timestamps: { createdAt: true, updatedAt: false },
		collection: 'advisor_alert_settings',
	}
);
alertSettingsSchema.index(
	{ orgId: 1 },
	{ unique: true, name: ALERT_SETTINGS_ORG_INDEX }
);

const clientContactSchema = new Schema<AdvisorClientContactDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		clientProfileId: { type: String, required: true },
		lastContactAt: { type: Date, required: true },
		recordedByUserId: { type: String, required: true },
	},
	{ ...baseOptions, collection: 'advisor_client_contacts' }
);
clientContactSchema.index(
	{ orgId: 1, clientProfileId: 1 },
	{ unique: true, name: CLIENT_CONTACT_CLIENT_INDEX }
);

export const advisorAttentionSchemas = {
	clientSnapshot: clientSnapshotSchema,
	wealthDaily: wealthDailySchema,
	alert: alertSchema,
	alertSettings: alertSettingsSchema,
	clientContact: clientContactSchema,
};
