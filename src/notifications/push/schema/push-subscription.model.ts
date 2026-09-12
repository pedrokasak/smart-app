import { Schema, Types, model } from 'mongoose';

/**
 * Assinatura Web Push de UM navegador de UM usuario (TRA-136, fase 6).
 *
 * Um usuario tem N documentos aqui — desktop, celular, um segundo perfil
 * do Chrome — e isso e o funcionamento normal, nao duplicidade. O que nao
 * pode existir e o MESMO endpoint duas vezes: o endpoint e a identidade da
 * assinatura para o push service, dai o unique index.
 *
 * `keys` guarda material criptografico. Nunca sai daqui: nenhuma rota
 * devolve, nenhum log imprime.
 */
export interface PushSubscription extends Document {
	_id?: Types.ObjectId;
	user: Types.ObjectId;
	endpoint: string;
	keys: {
		p256dh: string;
		auth: string;
	};
	userAgent?: string | null;
	/**
	 * Atualizado a cada re-registro do navegador. Serve de sinal de vida
	 * quando for preciso podar assinaturas que nunca mais apareceram.
	 */
	lastSeenAt?: Date;
	/**
	 * Falhas TRANSITORIAS consecutivas (429/5xx/rede). Zera no primeiro
	 * sucesso. Nao apaga nada sozinho — apagar so acontece em 404/410.
	 */
	failureCount: number;
	createdAt?: Date;
	updatedAt?: Date;
}

const pushSubscriptionSchema = new Schema<PushSubscription>(
	{
		user: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			index: true,
		},
		endpoint: {
			type: String,
			required: true,
			unique: true,
		},
		keys: {
			p256dh: { type: String, required: true },
			auth: { type: String, required: true },
		},
		userAgent: {
			type: String,
			default: null,
		},
		lastSeenAt: {
			type: Date,
			default: () => new Date(),
		},
		failureCount: {
			type: Number,
			default: 0,
		},
	},
	{ timestamps: true }
);

/**
 * O disparo diario le sempre "todas as assinaturas deste usuario". Com o
 * index por `user` acima isso ja e uma varredura de indice; o composto com
 * endpoint evita ler o documento so pra deduplicar por endpoint.
 */
pushSubscriptionSchema.index({ user: 1, endpoint: 1 });

export const PushSubscriptionModel = model<PushSubscription>(
	'PushSubscription',
	pushSubscriptionSchema
);
