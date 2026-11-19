import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
	AGENT_GATE,
	AgentGate,
} from 'src/agent-control/application/agent-gate.port';
import { AgentRun } from 'src/agent-control/application/agent-run.decorator';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from 'src/users/schema/user.model';
import { InvestorProfileService } from './investor-profile.service';

/**
 * Recalculo diario do perfil de sofisticacao do investidor (spec
 * 2026-08-27-ai-insights-adaptive-profile-redesign-design.md, secao 3.2).
 *
 * Roda 04:00 (America/Sao_Paulo) — depois do RagIngestionScheduler (03:00)
 * para nao competir por recursos. Calculo e local e barato (sem LLM, sem
 * API externa), entao roda para todos os usuarios, nao so Pro+.
 *
 * Override manual do usuario (campos overridden* no InvestorProfileModel)
 * nunca e sobrescrito por este job — InvestorProfileService.calculateAndPersist
 * so grava os campos inferidos, os campos overridden* ficam intocados.
 */
@Injectable()
export class InvestorProfileScheduler {
	private readonly logger = new Logger(InvestorProfileScheduler.name);

	constructor(
		@InjectModel('User') private readonly userModel: Model<User>,
		private readonly investorProfileService: InvestorProfileService,
		@Optional() @Inject(AGENT_GATE) private readonly agentGate?: AgentGate
	) {}

	@Cron('0 4 * * *', { timeZone: 'America/Sao_Paulo' })
	@AgentRun('investor-profile')
	async recalculateDaily(): Promise<void> {
		const users = await this.userModel.find({}, { _id: 1 });
		this.logger.log(
			`Recalculo de perfil de investidor: avaliando ${users.length} usuario(s).`
		);

		const results = await Promise.allSettled(
			users.map((user) =>
				this.investorProfileService.calculateAndPersist(String(user._id))
			)
		);

		const failures = results.filter((r) => r.status === 'rejected').length;
		const processed = results.length - failures;
		if (failures > 0) {
			this.logger.warn(
				`Recalculo de perfil de investidor: ${failures} falha(s) isolada(s).`
			);
		}
		this.logger.log(
			`Recalculo de perfil de investidor concluido: ${processed} processado(s), ${failures} falha(s).`
		);
	}
}
