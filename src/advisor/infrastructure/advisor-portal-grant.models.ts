import { randomUUID } from 'crypto';
import { Schema } from 'mongoose';

/**
 * Liberação do portal do assessor (P3a, U6), coleção `advisor_portal_grants`.
 * `userId` e `grantedBy` são strings opacas, sem ref para a coleção de
 * usuários.
 *
 * `active` existe só para o índice: índice parcial do Mongo não aceita
 * `revokedAt` ausente (`$exists: false`) no filtro, então a liberação ativa
 * é `active: true` e a revogação grava `active: false` junto com `revokedAt`.
 */
export const ADVISOR_PORTAL_GRANT_MODEL = 'AdvisorPortalGrant';

export interface AdvisorPortalGrantDoc {
	_id: string;
	userId: string;
	grantedBy: string;
	grantedAt: Date;
	revokedAt?: Date | null;
	active: boolean;
	createdAt: Date;
	updatedAt: Date;
}

/** Nome do índice que impede duas liberações ativas do mesmo usuário. */
export const PORTAL_GRANT_USER_ACTIVE_INDEX =
	'advisor_portal_grant_user_active';

export const advisorPortalGrantSchema = new Schema<AdvisorPortalGrantDoc>(
	{
		_id: { type: String, default: (): string => randomUUID() },
		userId: { type: String, required: true },
		grantedBy: { type: String, required: true },
		grantedAt: { type: Date, required: true },
		revokedAt: { type: Date },
		active: { type: Boolean, required: true },
	},
	{
		versionKey: false,
		timestamps: true,
		collection: 'advisor_portal_grants',
	}
);
// No máximo uma liberação ativa por usuário; as revogadas ficam de histórico.
advisorPortalGrantSchema.index(
	{ userId: 1 },
	{
		unique: true,
		name: PORTAL_GRANT_USER_ACTIVE_INDEX,
		partialFilterExpression: { active: true },
	}
);
