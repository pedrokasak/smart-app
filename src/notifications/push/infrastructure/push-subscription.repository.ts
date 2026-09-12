import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PushSubscription } from '../schema/push-subscription.model';

export type UpsertSubscriptionInput = {
	userId: Types.ObjectId;
	endpoint: string;
	keys: { p256dh: string; auth: string };
	userAgent?: string | null;
};

/**
 * Unico ponto do modulo que fala Mongo sobre assinaturas push.
 *
 * Regra de escopo, igual a do centro in-app: todo metodo que o usuario
 * dispara carrega `user` no filtro. `removeForUser` NAO existe numa versao
 * "por endpoint apenas" — se existisse, bastaria um endpoint vazado para
 * derrubar o push de outra pessoa.
 *
 * A excecao consciente e `deleteByEndpoint`, usada so pela limpeza de
 * assinatura morta (404/410), onde quem manda e o proprio push service e
 * nao existe usuario chamando.
 */
@Injectable()
export class PushSubscriptionRepository {
	constructor(
		@InjectModel('PushSubscription')
		private readonly model: Model<PushSubscription>
	) {}

	/**
	 * Idempotente por `endpoint`: o navegador reenvia a MESMA assinatura a
	 * cada carga da pagina. Upsert em vez de insert evita colecao inflada e
	 * push duplicado no mesmo aparelho.
	 *
	 * O filtro e so por endpoint (nao `user + endpoint`) de proposito: o
	 * endpoint e globalmente unico e pode trocar de dono quando duas contas
	 * usam o mesmo navegador. Nesse caso o `$set: user` transfere a
	 * assinatura para quem acabou de logar, em vez de estourar duplicate
	 * key e deixar o push chegando para a conta anterior.
	 */
	async upsert(input: UpsertSubscriptionInput): Promise<void> {
		await this.model.updateOne(
			{ endpoint: input.endpoint },
			{
				$set: {
					user: input.userId,
					keys: input.keys,
					userAgent: input.userAgent ?? null,
					lastSeenAt: new Date(),
					failureCount: 0,
				},
			},
			{ upsert: true }
		);
	}

	/** Remove a assinatura APENAS se ela pertencer ao usuario informado. */
	async removeForUser(
		userId: Types.ObjectId,
		endpoint: string
	): Promise<number> {
		const result = await this.model.deleteOne({ user: userId, endpoint });
		return result.deletedCount ?? 0;
	}

	async findByUser(userId: Types.ObjectId): Promise<PushSubscription[]> {
		return this.model.find({ user: userId }).lean<PushSubscription[]>();
	}

	async findByUsers(
		userIds: Types.ObjectId[]
	): Promise<Map<string, PushSubscription[]>> {
		const grouped = new Map<string, PushSubscription[]>();
		if (userIds.length === 0) return grouped;

		const docs = await this.model
			.find({ user: { $in: userIds } })
			.lean<PushSubscription[]>();

		for (const doc of docs) {
			const key = String(doc.user);
			const bucket = grouped.get(key);
			if (bucket) bucket.push(doc);
			else grouped.set(key, [doc]);
		}
		return grouped;
	}

	/**
	 * Limpeza de assinatura morta. Chamada apenas quando o push service
	 * respondeu 404/410 — o endpoint deixou de existir, entao nao ha dono a
	 * consultar.
	 */
	async deleteByEndpoint(endpoint: string): Promise<number> {
		const result = await this.model.deleteOne({ endpoint });
		return result.deletedCount ?? 0;
	}

	async registerFailure(endpoint: string): Promise<void> {
		await this.model.updateOne({ endpoint }, { $inc: { failureCount: 1 } });
	}

	async registerSuccess(endpoint: string): Promise<void> {
		await this.model.updateOne(
			{ endpoint },
			{ $set: { failureCount: 0, lastSeenAt: new Date() } }
		);
	}
}
