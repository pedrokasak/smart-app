import {
	Injectable,
	Logger,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import mongoose, { Connection, Model } from 'mongoose';
import { SubscriptionService } from 'src/subscription/subscription.service';

/**
 * Coleções com dado pessoal ou preferência do titular, sem obrigação de
 * retenção: saem junto com a conta (LGPD art. 18, VI). Registro fiscal
 * (Trade, Portfolio, PortfolioHistory, Asset, PixCharge, UserSubscription)
 * fica de fora até a decisão de retenção do TRA-127.
 */
export const ERASABLE_COLLECTIONS: ReadonlyArray<{
	model: string;
	ownerField: string;
}> = [
	{ model: 'BrokerConnection', ownerField: 'userId' },
	{ model: 'BrokerageNoteUpload', ownerField: 'userId' },
	{ model: 'Profile', ownerField: 'user' },
	{ model: 'InvestorProfile', ownerField: 'userId' },
	{ model: 'Address', ownerField: 'userId' },
	{ model: 'ChatMessage', ownerField: 'userId' },
	{ model: 'Notification', ownerField: 'user' },
	{ model: 'PushSubscription', ownerField: 'user' },
	{ model: 'ReportSchedule', ownerField: 'userId' },
	{ model: 'ThresholdState', ownerField: 'user' },
	{ model: 'FinancialPlan', ownerField: 'userId' },
	{ model: 'PortfolioTargetAllocation', ownerField: 'user' },
];

export interface ErasureReport {
	subscription: 'cancel_scheduled' | 'none';
	deleted: Record<string, number>;
	skipped: string[];
}

@Injectable()
export class AccountErasureService {
	private readonly logger = new Logger(AccountErasureService.name);

	constructor(
		@InjectConnection() private readonly connection: Connection,
		private readonly subscriptionService: SubscriptionService
	) {}

	/** Tudo o que depende do usuário, exceto o próprio documento `User`. */
	async eraseDependents(userId: string): Promise<ErasureReport> {
		const subscription = await this.stopBilling(userId);
		const deleted: Record<string, number> = {};
		const skipped: string[] = [];

		for (const { model, ownerField } of ERASABLE_COLLECTIONS) {
			const target = this.modelFor(model);
			if (!target) {
				skipped.push(model);
				continue;
			}
			const result = await target.deleteMany({ [ownerField]: userId });
			deleted[model] = result.deletedCount ?? 0;
		}

		if (skipped.length) {
			this.logger.error(
				`Exclusão de conta sem model registrado para: ${skipped.join(', ')}`
			);
		}
		return { subscription, deleted, skipped };
	}

	/**
	 * Cobrar quem apagou a conta é pior que recusar a exclusão por instantes:
	 * se o Stripe falhar, nada é apagado e o usuário tenta de novo.
	 */
	private async stopBilling(
		userId: string
	): Promise<ErasureReport['subscription']> {
		try {
			await this.subscriptionService.cancelUserSubscription(userId, true);
			return 'cancel_scheduled';
		} catch (error) {
			if (error instanceof NotFoundException) return 'none';
			this.logger.error(
				`Falha ao cancelar a assinatura antes da exclusão: ${(error as Error)?.message}`
			);
			throw new ServiceUnavailableException(
				'Não foi possível cancelar sua assinatura agora. Tente excluir a conta novamente em instantes.'
			);
		}
	}

	// Parte dos models é registrada pelo Nest e parte é estática (`model()`
	// global); os dois apontam para o mesmo banco.
	private modelFor(name: string): Model<any> | undefined {
		return this.connection.models[name] ?? mongoose.models[name];
	}
}
