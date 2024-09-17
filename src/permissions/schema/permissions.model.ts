import { model, Schema } from 'mongoose';

export interface Permission extends Document {
	name: string;
	profileId?: string;
	createdAt?: Date;
	updatedAt?: Date;
}

const permissionSchema = new Schema<Permission>({
	name: { type: String, required: true },
	profileId: {
		type: Schema.Types.ObjectId as any,
		ref: 'Profile',
		required: false,
	},
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

export const PermissionModel = model<Permission>(
	'Permission',
	permissionSchema
);
