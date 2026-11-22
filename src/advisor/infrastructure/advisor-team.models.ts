import { randomUUID } from 'crypto';
import { Schema } from 'mongoose';
import { MemberInviteStatus, OrgRole } from '../domain/enums';

/**
 * Coleções da equipe do escritório: atribuição de cliente a assessor e convite
 * de membro. Sem FK nem ref para outras coleções: `userId` e os ids de perfil
 * são strings opacas.
 */
export const ADVISOR_CLIENT_ASSIGNMENT_MODEL = 'AdvisorClientAssignment';
export const ADVISOR_MEMBER_INVITE_MODEL = 'AdvisorMemberInvite';

export const ADVISOR_CLIENT_ASSIGNMENTS_COLLECTION =
	'advisor_client_assignments';

/** Nomes dos índices únicos conferidos no erro 11000 dos stores. */
export const ASSIGNMENT_UNIQUE_INDEX = 'advisor_assignment_unique';
export const MEMBER_INVITE_PENDING_EMAIL_INDEX =
	'advisor_member_invite_org_email_pending';

interface TimestampedDoc {
	_id: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface AdvisorClientAssignmentDoc extends TimestampedDoc {
	orgId: string;
	clientProfileId: string;
	userId: string;
	assignedBy: string;
}

export interface AdvisorMemberInviteDoc extends TimestampedDoc {
	orgId: string;
	email: string;
	role: OrgRole;
	tokenHash: string;
	status: MemberInviteStatus;
	expiresAt: Date;
	resendCount: number;
	invitedByUserId: string;
	respondedAt?: Date | null;
}

const id = {
	type: String,
	default: (): string => randomUUID(),
};

const baseOptions = { versionKey: false, timestamps: true } as const;

const assignmentSchema = new Schema<AdvisorClientAssignmentDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		clientProfileId: { type: String, required: true },
		userId: { type: String, required: true },
		assignedBy: { type: String, required: true },
	},
	{ ...baseOptions, collection: ADVISOR_CLIENT_ASSIGNMENTS_COLLECTION }
);
// Atribuição idempotente; também serve `listByClient` e `deleteByClient`.
assignmentSchema.index(
	{ orgId: 1, clientProfileId: 1, userId: 1 },
	{ unique: true, name: ASSIGNMENT_UNIQUE_INDEX }
);
// `listClientIdsByUser` paginado e `deleteByUser`.
assignmentSchema.index(
	{ orgId: 1, userId: 1, createdAt: 1, _id: 1 },
	{ name: 'advisor_assignment_org_user_created' }
);
// `deleteAllForUser` (LGPD).
assignmentSchema.index({ userId: 1 }, { name: 'advisor_assignment_user' });

const memberInviteSchema = new Schema<AdvisorMemberInviteDoc>(
	{
		_id: id,
		orgId: { type: String, required: true },
		email: { type: String, required: true },
		role: { type: String, enum: Object.values(OrgRole), required: true },
		tokenHash: { type: String, required: true },
		status: {
			type: String,
			enum: Object.values(MemberInviteStatus),
			required: true,
		},
		expiresAt: { type: Date, required: true },
		resendCount: { type: Number, required: true, default: 0 },
		invitedByUserId: { type: String, required: true },
		respondedAt: { type: Date },
	},
	{ ...baseOptions, collection: 'advisor_member_invites' }
);
// O token é single-use e o hash identifica o convite.
memberInviteSchema.index(
	{ tokenHash: 1 },
	{ unique: true, name: 'advisor_member_invite_token_hash' }
);
// No máximo um convite PENDING por e-mail e organização.
memberInviteSchema.index(
	{ orgId: 1, email: 1 },
	{
		unique: true,
		name: MEMBER_INVITE_PENDING_EMAIL_INDEX,
		partialFilterExpression: { status: MemberInviteStatus.Pending },
	}
);
// `listPendingByOrg`.
memberInviteSchema.index(
	{ orgId: 1, status: 1, expiresAt: 1 },
	{ name: 'advisor_member_invite_org_status_expires' }
);
// `deleteByEmail` (LGPD).
memberInviteSchema.index({ email: 1 }, { name: 'advisor_member_invite_email' });

export const advisorTeamSchemas = {
	assignment: assignmentSchema,
	memberInvite: memberInviteSchema,
};
