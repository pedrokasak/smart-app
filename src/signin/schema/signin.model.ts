import { Schema, Document, model } from 'mongoose';

export interface SignIn extends Document {
	email: string;
	password: string;
	keepConnected: boolean;
	token: string;
	logon: Date;
}

const signinSchema = new Schema<SignIn>({
	email: { type: String, required: true, unique: true },
	password: { type: String, required: true },
	keepConnected: { type: Boolean, required: true },
	token: { type: String, required: true },
	logon: { type: Date, default: Date.now },
});

export const SignInModel = model<SignIn>('SignIn', signinSchema);
