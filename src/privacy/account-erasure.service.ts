import {
	Injectable,
	Logger,
	NotFoundException,
	ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import mongoose, { Connection, Model } from 'mongoose';
import { SubscriptionService } from 'src/subscription/subscription.service';
import {
	ERASABLE_COLLECTIONS,
	ERASED_USER_ID,
	PORTFOLIO_OWNED_COLLECTION,
	RETAINED_COLLECTIONS,
	RetainedCollection,
} from './account-erasure.policy';

export interface ErasureReport {
	subscription: 'cancel_scheduled' | 'none';
	deleted: Record<string, number>;
	anonymized: Record<string, number>;
	skipped: string[];
}

/**
 * Cada passo é idempotente e a ordem deixa o `User` por último: se algo falhar
 * no meio, o usuário ainda existe, repete a exclusão e o que já foi feito não
 * é refeito. Por isso não depende de transação (o Mongo do deploy não precisa
 * ser replica set).
 */
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
		const report: ErasureReport = {
			subscription,
			deleted: {},
			anonymized: {},
			skipped: [],
		};

		await this.erasePortfolioAssets(userId, report);
		await this.eraseOwned(userId, report);
		await this.anonymizeRetained(userId, report);

		if (report.skipped.length) {
			this.logger.error(
				`Exclusão de conta sem model registrado para: ${report.skipped.join(', ')}`
			);
		}
		return report;
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

	private async erasePortfolioAssets(userId: string, report: ErasureReport) {
		const { model, portfolioModel, portfolioOwnerField, field } =
			PORTFOLIO_OWNED_COLLECTION;
		const portfolios = this.modelFor(portfolioModel);
		const assets = this.modelFor(model);
		if (!portfolios || !assets) {
			report.skipped.push(model);
			return;
		}
		const portfolioIds = await portfolios.distinct('_id', {
			[portfolioOwnerField]: userId,
		});
		const result = await assets.deleteMany({ [field]: { $in: portfolioIds } });
		report.deleted[model] = result.deletedCount ?? 0;
	}

	private async eraseOwned(userId: string, report: ErasureReport) {
		for (const { model, ownerField } of ERASABLE_COLLECTIONS) {
			const target = this.modelFor(model);
			if (!target) {
				report.skipped.push(model);
				continue;
			}
			const result = await target.deleteMany({ [ownerField]: userId });
			report.deleted[model] = result.deletedCount ?? 0;
		}
	}

	private async anonymizeRetained(userId: string, report: ErasureReport) {
		for (const collection of RETAINED_COLLECTIONS) {
			const target = this.modelFor(collection.model);
			if (!target) {
				report.skipped.push(collection.model);
				continue;
			}
			const result = await target.updateMany(
				{ [collection.ownerField]: userId },
				this.anonymization(collection)
			);
			report.anonymized[collection.model] = result.modifiedCount ?? 0;
		}
	}

	private anonymization({ ownerField, scrub, unset }: RetainedCollection) {
		return {
			$set: { ...scrub, [ownerField]: ERASED_USER_ID },
			...(unset?.length
				? { $unset: Object.fromEntries(unset.map((f) => [f, ''])) }
				: {}),
		};
	}

	// Parte dos models é registrada pelo Nest e parte é estática (`model()`
	// global); os dois apontam para o mesmo banco.
	private modelFor(name: string): Model<any> | undefined {
		return this.connection.models[name] ?? mongoose.models[name];
	}
}
