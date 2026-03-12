import { Schema, model, Types, Document } from 'mongoose';

export interface BrokerConnection extends Document {
	userId: Types.ObjectId;
	provider: string;
	apiKeyEncrypted?: string;
	apiSecretEncrypted?: string;
	cpf?: string;
	status: 'connected' | 'disconnected' | 'error';
	lastSync?: Date;
	createdAt?: Date;
	updatedAt?: Date;
}

const brokerConnectionSchema = new Schema<BrokerConnection>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			index: true,
		},
		provider: {
			type: String,
			required: true,
			enum: ['b3', 'binance', 'coinbase', 'mercadobitcoin', 'bitso', 'other'],
		},
		apiKeyEncrypted: { type: String, select: false },
		apiSecretEncrypted: { type: String, select: false },
		cpf: String,
		status: {
			type: String,
			enum: ['connected', 'disconnected', 'error'],
			default: 'connected',
		},
		lastSync: Date,
	},
	{ timestamps: true }
);

// Índice composto: um usuário pode ter apenas uma conexão por provider
brokerConnectionSchema.index({ userId: 1, provider: 1 }, { unique: true });

export const BrokerConnectionModel = model<BrokerConnection>(
	'BrokerConnection',
	brokerConnectionSchema
);
