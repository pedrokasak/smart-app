import { Schema, Types, model } from 'mongoose';

/**
 * Estado da ultima avaliacao de limiar (TRA-136, fase 4).
 *
 * Colecao nova, nao um campo em User ou em Portfolio: o estado e por
 * (usuario, regra, escopo) e cresce com o numero de regras. Enfiar isso num
 * subdocumento do usuario transformaria cada avaliacao numa escrita no doc
 * mais lido do sistema.
 *
 * A chave composta e unica — e ela que garante que duas avaliacoes
 * concorrentes do mesmo balde nao criem dois estados e, com isso, duas
 * bordas de subida.
 */
export interface ThresholdStateDocument {
	_id?: Types.ObjectId;
	user: Types.ObjectId;
	ruleId: string;
	scope: string;
	breaching: boolean;
	referenceValue: number;
	lastNotifiedAt?: Date | null;
	lastEvaluatedAt: Date;
	createdAt?: Date;
	updatedAt?: Date;
}

const thresholdStateSchema = new Schema<ThresholdStateDocument>(
	{
		user: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		ruleId: { type: String, required: true },
		scope: { type: String, required: true, default: '' },
		breaching: { type: Boolean, required: true, default: false },
		referenceValue: { type: Number, required: true, default: 0 },
		lastNotifiedAt: { type: Date, default: null },
		lastEvaluatedAt: { type: Date, required: true },
	},
	{ timestamps: true, collection: 'threshold_states' }
);

thresholdStateSchema.index(
	{ user: 1, ruleId: 1, scope: 1 },
	{ unique: true, name: 'threshold_state_key' }
);

export const ThresholdStateModel = model<ThresholdStateDocument>(
	'ThresholdState',
	thresholdStateSchema
);
