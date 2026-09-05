import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { PushSubscriptionRepository } from '../infrastructure/push-subscription.repository';
import { WEB_PUSH_SENDER, WebPushSender } from './ports/web-push-sender.port';

/**
 * Casos de uso das assinaturas push do usuario autenticado.
 *
 * O `userId` chega SEMPRE do JWT (o controller o extrai) e nenhum metodo
 * aceita id de usuario vindo do corpo da requisicao. E o mesmo desenho do
 * centro in-app: escopo por dono nao depende de quem chama.
 */
@Injectable()
export class PushSubscriptionsService {
	constructor(
		private readonly repository: PushSubscriptionRepository,
		@Inject(WEB_PUSH_SENDER) private readonly sender: WebPushSender
	) {}

	/**
	 * Servida pelo backend em vez de embutida no bundle do front: rotacionar
	 * a chave VAPID passa a ser uma variavel de ambiente, nao um redeploy do
	 * `web`.
	 *
	 * String vazia quando o push esta desligado — o front le isso como
	 * "recurso indisponivel" e nao oferece o botao. Erro seria pior: o
	 * usuario veria uma falha para algo que simplesmente nao existe neste
	 * ambiente.
	 */
	vapidPublicKey(): { publicKey: string } {
		return { publicKey: this.sender.publicKey() };
	}

	async register(
		userId: string,
		input: {
			endpoint: string;
			keys: { p256dh: string; auth: string };
			userAgent?: string | null;
		}
	): Promise<{ registered: true }> {
		await this.repository.upsert({
			userId: this.toObjectId(userId),
			endpoint: input.endpoint,
			keys: input.keys,
			userAgent: input.userAgent ?? null,
		});
		return { registered: true };
	}

	/**
	 * Idempotente por contrato: remover um endpoint desconhecido devolve
	 * 200 com `removed: false`, nunca 404.
	 *
	 * O motivo nao e conforto de API. Um 404 aqui vazaria informacao: o
	 * cliente descobriria se um endpoint existe na base sem ser dono dele.
	 * Como o filtro de delete exige `user`, tentar apagar a assinatura de
	 * outra pessoa e indistinguivel de apagar algo inexistente.
	 */
	async unregister(
		userId: string,
		endpoint: string
	): Promise<{ removed: boolean }> {
		const deleted = await this.repository.removeForUser(
			this.toObjectId(userId),
			endpoint
		);
		return { removed: deleted > 0 };
	}

	private toObjectId(userId: string): Types.ObjectId {
		if (!userId || !Types.ObjectId.isValid(userId)) {
			throw new BadRequestException('Usuário inválido no token.');
		}
		return new Types.ObjectId(userId);
	}
}
