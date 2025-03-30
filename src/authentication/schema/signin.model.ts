import { Schema, Document, model } from 'mongoose';

export interface Authentication extends Document {
	email: string;
	password: string;
	keepConnected: boolean;
	token: string;
	logon: Date;
}

const AuthenticationSchema = new Schema<Authentication>({
	email: { type: String, required: true, unique: true },
	password: { type: String, required: true },
	keepConnected: { type: Boolean, required: true },
	token: { type: String, required: true },
	logon: { type: Date, default: Date.now },
});

export const AuthenticationModel = model<Authentication>(
	'SignIn',
	AuthenticationSchema
);
