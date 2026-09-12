import { RELEASE_BAND_FACTOR, decideEdge } from '../edge-trigger';
import {
	ResolvedThresholdPolicy,
	THRESHOLD_RULE_IDS,
	ThresholdDecision,
	ThresholdRule,
	ThresholdStateSnapshot,
} from '../threshold.types';

export interface QuoteStaleInput {
	symbol: string;
	minutesSinceLastQuote: number;
	/** Epoch (ms) da ultima leitura bem-sucedida. Identifica o EPISODIO. */
	lastQuoteAtMs: number;
}

/**
 * Regra da cotacao parada (TRA-136, fase 7).
 *
 * Este evento nasceu classificado como DISCRETO no roteamento, quando ainda
 * nao tinha produtor — a suposicao registrada la era que "a janela seria do
 * proprio produtor". Com o produtor escrito, a suposicao nao se sustenta:
 * cotacao parada nao e um fato pontual como um provento creditado, e uma
 * CONDICAO QUE FICA DE PE. A fonte que parou de responder por PETR4 vai
 * continuar parada amanha, e depois. Discreto, cada varredura viraria uma
 * notificacao, e uma semana de instabilidade da fonte custaria sete
 * e-mails identicos — o ruido que o motor existe para eliminar.
 *
 * Por isso a regra, com escopo POR SIMBOLO: PETR4 parada e um fato
 * diferente de BTC parado, cada um arma e desarma sozinho.
 *
 * O detalhe que faz a borda funcionar aqui: o produtor so publica quando o
 * simbolo JA esta atrasado, entao nunca chega uma leitura "fresca" para
 * desarmar pela borda de descida. Quem desarma e a IDENTIDADE DO EPISODIO —
 * `lastQuoteAtMs`. Enquanto o carimbo for o mesmo, e o mesmo silencio
 * seguindo em frente, e o cooldown manda. Se o carimbo AVANCOU, houve
 * leitura bem-sucedida no meio: o episodio anterior acabou e este e novo,
 * entao a regra descarta o estado anterior e trata como borda de subida.
 * Sem isso, um simbolo que voltou a atualizar e parou de novo dois dias
 * depois ficaria calado, porque o estado teria continuado armado.
 */
export class QuoteStaleRule implements ThresholdRule<QuoteStaleInput> {
	readonly id = THRESHOLD_RULE_IDS.QuoteStale;

	scopeOf(input: QuoteStaleInput): string {
		return String(input.symbol ?? '')
			.trim()
			.toUpperCase();
	}

	evaluate(
		input: QuoteStaleInput,
		previous: ThresholdStateSnapshot | null,
		policy: ResolvedThresholdPolicy,
		now: Date
	): ThresholdDecision {
		const scope = this.scopeOf(input);

		if (
			!scope ||
			!Number.isFinite(input.minutesSinceLastQuote) ||
			input.minutesSinceLastQuote < 0 ||
			!Number.isFinite(input.lastQuoteAtMs)
		) {
			return {
				ruleId: this.id,
				scope,
				outcome: 'invalid',
				reason: 'leitura de frescor sem simbolo ou sem idade valida',
				shouldNotify: false,
				nextState: null,
				evidence: [],
				metrics: {},
			};
		}

		const breachAt = policy.quoteStaleAfterMinutes;
		// Mesmo episodio = mesmo carimbo de ultima leitura. Carimbo mais novo
		// significa que a cotacao voltou em algum momento: o estado anterior
		// nao descreve mais este silencio.
		const sameEpisode =
			previous !== null && previous.referenceValue === input.lastQuoteAtMs;

		const edge = decideEdge({
			magnitude: input.minutesSinceLastQuote,
			breachAt,
			releaseAt: breachAt * RELEASE_BAND_FACTOR,
			previous: sameEpisode ? previous : null,
			cooldownHours: policy.cooldownHours,
			now,
			referenceValue: input.lastQuoteAtMs,
		});

		const hours = input.minutesSinceLastQuote / 60;

		return {
			ruleId: this.id,
			scope,
			outcome: edge.outcome,
			reason: sameEpisode
				? edge.reason
				: `${edge.reason} (episodio novo: houve leitura desde a ultima avaliacao)`,
			shouldNotify: edge.shouldNotify,
			nextState: edge.nextState,
			evidence: [
				{ label: 'Simbolo', value: scope, source: 'quote.symbol' },
				{
					label: 'Ultima cotacao lida',
					value: new Date(input.lastQuoteAtMs).toISOString(),
					source: 'quote.lastQuoteAt',
				},
				{
					label: 'Horas sem atualizacao',
					value: round2(hours),
					source: 'quote.hoursSinceLastQuote',
				},
				{
					label: 'Limite de atraso (horas)',
					value: round2(breachAt / 60),
					source: 'threshold.quoteStaleAfterMinutes',
				},
			],
			metrics: {
				minutesSinceLastQuote: Math.round(input.minutesSinceLastQuote),
				hoursSinceLastQuote: round2(hours),
				staleAfterMinutes: Math.round(breachAt),
			},
		};
	}
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}
