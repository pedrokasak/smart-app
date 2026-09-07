import { Schema, model, Types, Document } from 'mongoose';
import {
	BROKER_SYNC_ERROR_CATEGORIES,
	BrokerSyncErrorCategory,
} from 'src/broker-sync/domain/broker-sync-error';

export interface BrokerConnection extends Document {
	userId: Types.ObjectId;
	provider: string;
	apiKeyEncrypted?: string;
	apiSecretEncrypted?: string;
	apiPassphraseEncrypted?: string;
	cpf?: string;
	status: 'connected' | 'disconnected' | 'error';
	lastSync?: Date;
	/**
	 * Mensagem segura, derivada de `lastErrorCode` — NUNCA o texto do
	 * provedor (TRK-011). Linhas gravadas antes desta mudanca ainda podem
	 * conter texto cru; por isso o serviço nunca as devolve sem
	 * `lastErrorCode` ao lado (ver `getConnections`).
	 */
	lastError?: string;
	/** Categoria fechada da falha. Ver `domain/broker-sync-error.ts`. */
	lastErrorCode?: BrokerSyncErrorCategory;
	/** Status HTTP devolvido pela corretora, quando houve resposta HTTP. */
	lastErrorStatus?: number;
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
		apiPassphraseEncrypted: { type: String, select: false },
		cpf: String,
		status: {
			type: String,
			enum: ['connected', 'disconnected', 'error'],
			default: 'connected',
		},
		lastSync: Date,
		lastError: String,
		lastErrorCode: {
			type: String,
			enum: BROKER_SYNC_ERROR_CATEGORIES,
		},
		lastErrorStatus: Number,
	},
	{ timestamps: true }
);

// Índice composto: um usuário pode ter apenas uma conexão por provider
brokerConnectionSchema.index({ userId: 1, provider: 1 }, { unique: true });

export const BrokerConnectionModel = model<BrokerConnection>(
	'BrokerConnection',
	brokerConnectionSchema
);
