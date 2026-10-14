import { Injectable, Logger } from '@nestjs/common';
import { InvestorProfileService } from 'src/intelligence/application/investor-profile/investor-profile.service';
import { InvestmentPolicyService } from 'src/investment-policy/investment-policy.service';
import type { ChatOrchestratorResponse } from 'src/ai/orchestration/chat-orchestrator.types';
import {
	composeDidactic,
	hasDidacticComposer,
	renderDidactic,
	type DidacticContext,
	type DidacticInput,
} from './copilot-didactic';
import { didacticLevelFrom, type DidacticAnswer } from './didactic.types';

/** Avisos que já têm mensagem própria no controller (ativo fora da carteira etc.). */
const BLOCKING_WARNINGS = new Set([
	'sell_simulation_requires_owned_asset',
	'tax_estimation_requires_owned_asset',
	'missing_sell_price_for_simulation',
]);

export interface DidacticPart {
	/** `null` quando a intenção não tem compositor ou faltou dado. */
	didactic: DidacticAnswer | null;
	/** Texto da bolha; `null` mantém a mensagem de sempre. */
	message: string | null;
}

/**
 * Lê o nível da pessoa e a política dela uma vez por pergunta e monta a
 * resposta didática de cada parte. Tudo best-effort: se o perfil ou a
 * política falharem, cai no nível intermediário sem política, e o chat
 * nunca quebra por causa da camada didática.
 */
@Injectable()
export class CopilotDidacticService {
	private readonly logger = new Logger(CopilotDidacticService.name);

	constructor(
		private readonly investorProfileService: InvestorProfileService,
		private readonly investmentPolicyService: InvestmentPolicyService
	) {}

	/**
	 * Uma entrada por parte da resposta, na mesma ordem. Avisos do
	 * orquestrador (ativo fora da carteira, preço indisponível) têm prioridade:
	 * essas partes seguem com a mensagem de sempre.
	 */
	async explain(
		userId: string,
		question: string,
		parts: ChatOrchestratorResponse[]
	): Promise<DidacticPart[]> {
		const eligible = parts.map(
			(part) =>
				hasDidacticComposer(part.intent) &&
				!part.warnings?.some((warning) => BLOCKING_WARNINGS.has(warning))
		);
		if (!eligible.some(Boolean)) {
			return parts.map(() => ({ didactic: null, message: null }));
		}
		const ctx = await this.loadContext(userId);
		return parts.map((part, index) => {
			const didactic = eligible[index]
				? this.compose(
						{ intent: part.intent, question, data: part.data || {} },
						ctx
					)
				: null;
			return { didactic, message: didactic ? renderDidactic(didactic) : null };
		});
	}

	async loadContext(userId: string): Promise<DidacticContext> {
		const [profile, policy] = await Promise.allSettled([
			this.investorProfileService.getEffectiveProfile(userId),
			this.investmentPolicyService.get(userId),
		]);
		if (profile.status === 'rejected' || policy.status === 'rejected') {
			this.logger.warn(
				`didactic context partial for ${userId}: profile=${profile.status} policy=${policy.status}`
			);
		}
		return {
			level: didacticLevelFrom(
				profile.status === 'fulfilled' ? profile.value?.sophistication : null
			),
			policy: policy.status === 'fulfilled' ? policy.value.policy : null,
			policyIsDefault:
				policy.status === 'fulfilled' ? policy.value.isDefault : false,
		};
	}

	compose(input: DidacticInput, ctx: DidacticContext): DidacticAnswer | null {
		try {
			return composeDidactic(input, ctx);
		} catch (error: any) {
			this.logger.warn(
				`didactic compose failed for ${input.intent}: ${error?.message || 'unknown_error'}`
			);
			return null;
		}
	}
}
