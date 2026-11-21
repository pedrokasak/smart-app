import { randomUUID } from 'crypto';
import { Schema } from 'mongoose';
import { ConsentStatus, InviteStatus } from '../domain/enums';

/**
 * Coleções de convite e consentimento. Sem FK nem ref para coleções de
 * outros módulos: `userId` e os ids de carteira são strings opacas.
 */
export const ADVISOR_CLIENT_INVITE_MODEL = 'AdvisorClientInvite';
export const ADVISOR_CONSENT_MODEL = 'AdvisorConsent';

interface TimestampedDoc {
	_id: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface AdvisorClientInviteDoc extends TimestampedDoc {
	orgId: string;
	clientProfileId: string;
	relationshipId: string;
	email: string;
	tokenHash: string;
	status: InviteStatus;
	expiresAt: Date;
	resendCount: number;
	invitedByUserId: string;
	respondedAt?: Date | null;
}

export interface AdvisorConsentDoc extends TimestampedDoc {
	orgId: string;
	clientProfileId: string;
	relationshipId: string;
	userId: string;
	portfolioIds: string[];
	version: number;
	textVersion: string;
	status: ConsentStatus;
	grantedAt: Date;
	endedAt?: Date | null;
}

/** Nome do índice que impede dois vínculos ACTIVE do mesmo usuário e org. */
export const CONSENT_USER_ORG_ACTIVE_INDEX = 'advisor_consent_user_org_active';

const id = {
	type: String,
	default: (): string => randomUUID(),
};

const baseOptions = { versionKey: false, timestamps: true } as const;

const clientInviteSchema = new Schema<AdvisorClientInviteDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		clientProfileId: { type: String, required: true },
		relationshipId: { type: String, required: true },
		email: { type: String, required: true },
		tokenHash: { type: String, required: true },
		status: {
			type: String,
			enum: Object.values(InviteStatus),
			required: true,
		},
		expiresAt: { type: Date, required: true },
		resendCount: { type: Number, required: true, default: 0 },
		invitedByUserId: { type: String, required: true },
		respondedAt: { type: Date },
	},
	{ ...baseOptions, collection: 'advisor_client_invites' }
);
// O token é single-use e o hash identifica o convite.
clientInviteSchema.index(
	{ tokenHash: 1 },
	{ unique: true, name: 'advisor_invite_token_hash' }
);
clientInviteSchema.index(
	{ orgId: 1, email: 1, status: 1 },
	{ name: 'advisor_invite_org_email_status' }
);
// `listPendingByOrg`: convites pendentes e ainda válidos da organização.
clientInviteSchema.index(
	{ orgId: 1, status: 1, expiresAt: 1 },
	{ name: 'advisor_invite_org_status_expires' }
);
// `deleteByEmail` (LGPD).
clientInviteSchema.index({ email: 1 }, { name: 'advisor_invite_email' });

const consentSchema = new Schema<AdvisorConsentDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		clientProfileId: { type: String, required: true },
		relationshipId: { type: String, required: true },
		userId: { type: String, required: true },
		portfolioIds: { type: [String], default: [] },
		version: { type: Number, required: true },
		textVersion: { type: String, required: true },
		status: {
			type: String,
			enum: Object.values(ConsentStatus),
			required: true,
		},
		grantedAt: { type: Date, required: true },
		endedAt: { type: Date },
	},
	{ ...baseOptions, collection: 'advisor_consents' }
);
// No máximo um consentimento ACTIVE por relação.
consentSchema.index(
	{ relationshipId: 1 },
	{
		unique: true,
		name: 'advisor_consent_relationship_active',
		partialFilterExpression: { status: ConsentStatus.Active },
	}
);
// Versões de uma relação nunca se repetem (grants concorrentes).
consentSchema.index(
	{ relationshipId: 1, version: 1 },
	{ unique: true, name: 'advisor_consent_relationship_version' }
);
consentSchema.index({ userId: 1, status: 1 }, { name: 'advisor_consent_user' });
// Dois convites da mesma org aceitos em paralelo não geram dois ACTIVE.
consentSchema.index(
	{ userId: 1, orgId: 1 },
	{
		unique: true,
		name: CONSENT_USER_ORG_ACTIVE_INDEX,
		partialFilterExpression: { status: ConsentStatus.Active },
	}
);

export const advisorConsentSchemas = {
	clientInvite: clientInviteSchema,
	consent: consentSchema,
};
