import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import mongoose, { Connection, Model } from 'mongoose';
import {
	PlanQuotaResource,
	PlanQuotaUsagePort,
} from 'src/subscription/application/plan-quotas';

/**
 * Conta o que o usuário já tem. Acessa os models pelo nome registrado, como a
 * exclusão de conta, para a assinatura não depender dos módulos de carteira,
 * ativos e corretora (que já dependem dela).
 */
@Injectable()
export class MongoPlanQuotaUsage implements PlanQuotaUsagePort {
	private readonly logger = new Logger(MongoPlanQuotaUsage.name);

	constructor(@InjectConnection() private readonly connection: Connection) {}

	async count(userId: string, resource: PlanQuotaResource): Promise<number> {
		switch (resource) {
			case 'portfolios':
				return this.model('Portfolio').countDocuments({ userId });
			case 'broker_connections':
				return this.model('BrokerConnection').countDocuments({ userId });
			case 'assets': {
				const portfolioIds = await this.model('Portfolio').distinct('_id', {
					userId,
				});
				if (!portfolioIds.length) return 0;
				return this.model('Asset').countDocuments({
					portfolioId: { $in: portfolioIds },
				});
			}
		}
	}

	// Falhar alto: contar zero por model ausente liberaria a cota inteira.
	private model(name: string): Model<any> {
		const found = this.connection.models[name] ?? mongoose.models[name];
		if (!found) {
			this.logger.error(`Model ${name} não registrado para contar cota`);
			throw new Error(`Model ${name} não registrado`);
		}
		return found;
	}
}
