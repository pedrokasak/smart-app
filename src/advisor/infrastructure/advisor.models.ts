import { randomUUID } from 'crypto';
import { Schema } from 'mongoose';
import {
	AdvisorType,
	OrgRole,
	ProfileOrigin,
	RelationshipStatus,
} from '../domain/enums';

/**
 * Coleções do módulo advisor. Sem FK nem ref para coleções de outros módulos:
 * `userId` é só uma string opaca.
 */
export const ADVISOR_ORGANIZATION_MODEL = 'AdvisorOrganization';
export const ADVISOR_MEMBERSHIP_MODEL = 'AdvisorMembership';
export const ADVISOR_RELATIONSHIP_MODEL = 'AdvisorRelationship';
export const ADVISOR_CLIENT_PROFILE_MODEL = 'AdvisorClientProfile';

/** Nomes dos índices únicos conferidos no erro 11000 dos stores. */
export const ORGANIZATION_OWNER_INDEX = 'advisor_organization_owner_unique';
export const MEMBERSHIP_USER_ORG_INDEX = 'advisor_membership_user_org';

interface TimestampedDoc {
	_id: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface AdvisorOrganizationDoc extends TimestampedDoc {
	name: string;
	advisorType: AdvisorType;
	plan?: string | null;
	ownerUserId?: string | null;
}

export interface AdvisorMembershipDoc extends TimestampedDoc {
	userId: string;
	orgId: string;
	role: OrgRole;
}

export interface AdvisorRelationshipDoc extends TimestampedDoc {
	orgId: string;
	clientProfileId: string;
	status: RelationshipStatus;
	consentId?: string | null;
	scope?: string[] | null;
}

export interface AdvisorClientProfileDoc extends TimestampedDoc {
	orgId: string;
	name: string;
	origin: ProfileOrigin;
	ownerUserId?: string | null;
}

/** `_id` é uma string (uuid): id malformado vira "não encontrado", nunca CastError. */
const id = {
	type: String,
	default: (): string => randomUUID(),
};

const baseOptions = { versionKey: false, timestamps: true } as const;

const organizationSchema = new Schema<AdvisorOrganizationDoc>(
	{
		_id: id,
		name: { type: String, required: true },
		advisorType: {
			type: String,
			enum: Object.values(AdvisorType),
			required: true,
		},
		plan: { type: String },
		ownerUserId: { type: String },
	},
	{ ...baseOptions, collection: 'advisor_organizations' }
);
// Uma organização por dono; organizações sem dono não entram no índice.
organizationSchema.index(
	{ ownerUserId: 1 },
	{
		unique: true,
		name: ORGANIZATION_OWNER_INDEX,
		partialFilterExpression: { ownerUserId: { $type: 'string' } },
	}
);

const membershipSchema = new Schema<AdvisorMembershipDoc>(
	{
		_id: id,
		userId: { type: String, required: true },
		orgId: { type: String, required: true },
		role: { type: String, enum: Object.values(OrgRole), required: true },
	},
	{ ...baseOptions, collection: 'advisor_memberships' }
);
// Um vínculo por usuário e organização; também serve `findByUserAndOrg`.
membershipSchema.index(
	{ userId: 1, orgId: 1 },
	{ unique: true, name: MEMBERSHIP_USER_ORG_INDEX }
);
// `findByUser` em ordem estável.
membershipSchema.index(
	{ userId: 1, createdAt: 1, _id: 1 },
	{ name: 'advisor_membership_user_created' }
);
// `listByOrg` em ordem estável.
membershipSchema.index(
	{ orgId: 1, createdAt: 1, _id: 1 },
	{ name: 'advisor_membership_org_created' }
);

const relationshipSchema = new Schema<AdvisorRelationshipDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		clientProfileId: { type: String, required: true },
		status: {
			type: String,
			enum: Object.values(RelationshipStatus),
			required: true,
		},
		consentId: { type: String },
		scope: { type: [String], default: undefined },
	},
	{ ...baseOptions, collection: 'advisor_relationships' }
);
// No máximo uma relação ACTIVE por organização e perfil; as revogadas ficam
// como histórico.
relationshipSchema.index(
	{ orgId: 1, clientProfileId: 1 },
	{
		unique: true,
		name: 'advisor_relationship_active_unique',
		partialFilterExpression: { status: RelationshipStatus.Active },
	}
);
relationshipSchema.index(
	{ orgId: 1, clientProfileId: 1, createdAt: -1 },
	{ name: 'advisor_relationship_org_client_recent' }
);
// `listByOrg`: filtro por org e status, ordem de criação decrescente.
relationshipSchema.index(
	{ orgId: 1, status: 1, createdAt: -1 },
	{ name: 'advisor_relationship_org_status_created' }
);

const clientProfileSchema = new Schema<AdvisorClientProfileDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		name: { type: String, required: true },
		origin: {
			type: String,
			enum: Object.values(ProfileOrigin),
			required: true,
		},
		ownerUserId: { type: String },
	},
	{ ...baseOptions, collection: 'advisor_client_profiles' }
);

export const advisorSchemas = {
	organization: organizationSchema,
	membership: membershipSchema,
	relationship: relationshipSchema,
	clientProfile: clientProfileSchema,
};
