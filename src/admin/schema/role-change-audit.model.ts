import { Document, Schema, Types, model } from 'mongoose';
import { Role } from 'src/auth/enums/role.enum';

export const ROLE_CHANGE_BOOTSTRAP_ACTOR = 'system:bootstrap';

export interface RoleChangeAudit extends Document {
	user: Types.ObjectId;
	userEmail: string;
	previousRole: Role;
	newRole: Role;
	performedBy?: Types.ObjectId;
	performedByEmail: string;
	createdAt?: Date;
}

const roleChangeAuditSchema = new Schema<RoleChangeAudit>(
	{
		user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
		userEmail: { type: String, required: true, lowercase: true, trim: true },
		previousRole: { type: String, required: true },
		newRole: { type: String, required: true },
		performedBy: { type: Schema.Types.ObjectId, ref: 'User' },
		performedByEmail: {
			type: String,
			required: true,
			lowercase: true,
			trim: true,
		},
	},
	{ timestamps: { createdAt: true, updatedAt: false } }
);

roleChangeAuditSchema.index({ createdAt: -1 });
roleChangeAuditSchema.index({ userEmail: 1 });

export const RoleChangeAuditModel = model<RoleChangeAudit>(
	'RoleChangeAudit',
	roleChangeAuditSchema
);
