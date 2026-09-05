import { Inject, Injectable, Logger } from '@nestjs/common';
import {
	EVENT_PUBLISHER,
	EventPublisher,
} from 'src/events/application/ports/event-publisher.port';
import { createDomainEvent } from 'src/events/domain/domain-event.factory';
import { DOMAIN_EVENT_TYPES } from 'src/events/domain/event-types';
import { InsightDto } from 'src/ai/dto/insight.dto';

/**
 * Bucket de confianca que o trackerr-ia ja calcula (`InsightConfidenceDto`)
 * e o unico sinal de prioridade que o servidor tem hoje sem inventar regra.
 */
const HIGH_PRIORITY_BUCKET = 'alta';

/**
 * Teto por resposta. Uma rodada de insights pode devolver varios em 'alta';
 * mandar todos viraria uma rajada de e-mails sobre uma consulta unica.
 */
const MAX_EVENTS_PER_RESPONSE = 3;

/**
 * Produtor de `ai.insight.high_priority` (TRA-136, fase 3).
 *
 * O servidor nao produz insight — ele recebe do trackerr-ia e repassa.
 * Entao o produtor mora aqui, no ponto em que a resposta chega, e usa o
 * unico marcador de prioridade que ja vem no contrato: `confidence.bucket`.
 *
 * TODO(TRA-136 fase 4): "alta prioridade" de verdade nao e so confianca —
 * envolve severidade, o quanto mudou desde a leitura anterior e politica
 * por usuario. Isso e do motor de limiares. Aqui o evento leva o numero
 * cru (`confidence.value`) e o texto, e a decisao fica para la.
 *
 * TODO(TRA-136 fase 5): hoje o evento so nasce quando o usuario pede
 * insights pela rota. A chamada agendada ao trackerr-ia — que e o que
 * torna o aviso proativo — e da fase 5.
 *
 * Nunca lanca: a rota /ai/insights responde 200 mesmo com o barramento
 * fora do ar.
 */
@Injectable()
export class AiInsightProducer {
	private readonly logger = new Logger(AiInsightProducer.name);

	constructor(
		@Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher
	) {}

	async publishHighPriority(
		userId: string,
		insights: InsightDto[] | undefined
	): Promise<void> {
		try {
			if (!userId || !Array.isArray(insights)) return;

			const altos = insights
				.filter((insight) => isHighPriority(insight))
				.slice(0, MAX_EVENTS_PER_RESPONSE);

			for (const insight of altos) {
				const summary = pickSummary(insight);
				if (!insight.title?.trim() || !summary) continue;

				await this.publisher.publish(
					createDomainEvent({
						type: DOMAIN_EVENT_TYPES.AiInsightHighPriority,
						subject: userId,
						producer: 'server.ai.insights',
						payload: {
							title: insight.title,
							summary,
							insightId: insight.id,
						},
					})
				);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(
				`Falha ao publicar insight de alta prioridade do usuario ${userId}: ${message}`
			);
		}
	}
}

function isHighPriority(insight: InsightDto): boolean {
	return insight?.confidence?.bucket === HIGH_PRIORITY_BUCKET;
}

/**
 * `rationale` e o texto novo (TRA-56); `body` e o legado que o front ja
 * consome. Preferir o primeiro e cair no segundo mantem o evento util para
 * as duas versoes do contrato.
 */
function pickSummary(insight: InsightDto): string {
	return (insight?.rationale || insight?.body || '').trim();
}
