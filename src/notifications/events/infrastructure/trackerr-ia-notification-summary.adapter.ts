import { Injectable, Logger } from '@nestjs/common';
import { AiService } from 'src/ai/ai.service';
import { InsightDto } from 'src/ai/dto/insight.dto';
import {
	NotificationSummaryProvider,
	NotificationSummaryRequest,
	TransientSummaryError,
} from '../application/ports/notification-summary.port';

/** Teto do texto persistido. Resumo e paragrafo, nao relatorio. */
const MAX_SUMMARY_CHARS = 600;

/**
 * Resumo sob demanda pelo trackerr-ia (TRA-136, fase 5).
 *
 * REUSA `AiService.getInsights` — nao existe um segundo cliente HTTP para o
 * trackerr-ia neste servidor, e nao e aqui que vai nascer. O que muda em
 * relacao a chamada da rota sao duas opcoes:
 *
 *   - `publishInsightEvents: false`. A chamada acontece DENTRO do worker
 *     que esta tratando um evento; publicar `ai.insight.high_priority` a
 *     partir dela criaria um laco evento -> resumo -> evento -> resumo.
 *   - `timeoutMs` curto (default 8s, contra os 30s da rota). Aqui o usuario
 *     nao esta esperando resposta, mas o job esta ocupando um slot de
 *     concorrencia da fila; segurar 30s por um enriquecimento opcional
 *     atrasa notificacao de outra gente.
 *
 * ANTI-ALUCINACAO: o `user_profile` enviado carrega SO a evidencia que o
 * motor de limiares calculou, mais a copy deterministica como ancora.
 * Nenhum numero novo entra por aqui — o lado do trackerr-ia ja rejeita
 * figura ausente da evidencia (TRA-55/56) e este adaptador nao lhe da
 * material para inventar.
 *
 * Falha transitoria vira `TransientSummaryError` e sobe: quem chama ja
 * mandou a notificacao determinista, entao o retry da fila so busca o
 * enriquecimento. Falha permanente (payload estranho, resposta vazia)
 * devolve `null` — repetir daria o mesmo nada cinco vezes.
 */
@Injectable()
export class TrackerrIaNotificationSummaryAdapter implements NotificationSummaryProvider {
	private readonly logger = new Logger(
		TrackerrIaNotificationSummaryAdapter.name
	);

	constructor(private readonly ai: AiService) {}

	private get enabled(): boolean {
		return (
			(process.env.NOTIFICATION_AI_SUMMARY_ENABLED ?? 'true')
				.trim()
				.toLowerCase() !== 'false'
		);
	}

	private get timeoutMs(): number {
		const raw = Number(process.env.NOTIFICATION_AI_SUMMARY_TIMEOUT_MS);
		return Number.isFinite(raw) && raw > 0 ? raw : 8000;
	}

	async summarize(request: NotificationSummaryRequest): Promise<string | null> {
		if (!this.enabled) return null;
		if (request.evidence.length === 0) return null;

		try {
			const response = await this.ai.getInsights(
				{
					user_id: request.userId,
					// Contexto minimo e fechado. O trackerr-ia recebe o fato ja
					// decidido, nao a carteira inteira.
					notification: {
						type: request.notificationType,
						rule_id: request.ruleId,
						scope: request.scope,
						title: request.deterministicTitle,
						body: request.deterministicBody,
					},
					evidence: request.evidence.map((item) => ({
						label: item.label,
						value: item.value,
						source: item.source,
					})),
				},
				undefined,
				{ publishInsightEvents: false, timeoutMs: this.timeoutMs }
			);

			return pickSummary(response?.insights);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (isTransient(err)) {
				throw new TransientSummaryError(message);
			}
			this.logger.warn(
				`Resumo do trackerr-ia falhou de forma permanente: ${message}`
			);
			return null;
		}
	}
}

function pickSummary(insights: InsightDto[] | undefined): string | null {
	if (!Array.isArray(insights) || insights.length === 0) return null;
	const first = insights[0];
	const text = (first?.rationale || first?.body || '').trim();
	if (!text) return null;
	return text.length > MAX_SUMMARY_CHARS
		? `${text.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`
		: text;
}

/**
 * `AiService` embrulha tudo em `InternalServerErrorException`, entao a
 * classificacao vai pela mensagem. Timeout, queda de rede e 5xx sao
 * transitorios; o resto nao melhora com repeticao.
 */
function isTransient(err: unknown): boolean {
	const message = (err instanceof Error ? err.message : String(err))
		.toLowerCase()
		.trim();

	return [
		'timeout',
		'timedout',
		'econnaborted',
		'econnreset',
		'econnrefused',
		'enotfound',
		'ehostunreach',
		'socket hang up',
		'network error',
		'bad gateway',
		'service unavailable',
		'gateway timeout',
		'internal server error',
		// Fallback generico do AiService quando o axios nao devolve detalhe —
		// na pratica, trackerr-ia inalcancavel.
		'erro ao conectar',
	].some((marker) => message.includes(marker));
}
