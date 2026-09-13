import { ThresholdOutcome, ThresholdStateSnapshot } from './threshold.types';

/**
 * Nucleo do motor: a decisao de borda, isolada de qualquer regra concreta.
 *
 * Toda regra de limiar desta issue reduz a mesma pergunta — "o valor
 * observado passou do corte, e isso ACABOU de acontecer?". Escrever a
 * comparacao uma vez so evita que a proxima regra reinvente a histerese
 * errado.
 *
 * Tres mecanismos, nesta ordem:
 *
 * 1. BORDA DE SUBIDA (edge-triggered). Notifica quando a condicao passa de
 *    falsa para verdadeira. Enquanto ela continuar verdadeira, o motor
 *    cala — e a diferenca entre "sua cripto passou da meta" (uma vez) e o
 *    mesmo e-mail todo dia ate o usuario rebalancear.
 *
 * 2. HISTERESE (banda de liberacao). Desarmar exige voltar bem para dentro
 *    da banda, nao apenas encostar nela por baixo. Sem isso, um valor
 *    oscilando em torno do corte (32,01% / 31,99% / 32,01%) desarmaria e
 *    rearmaria a cada leitura, produzindo exatamente a rajada que a borda
 *    existe para evitar. A zona morta entre `releaseAt` e `breachAt`
 *    mantem o estado armado sem notificar.
 *
 * 3. RE-ARME POR COOLDOWN. Uma condicao pode ficar de pe por semanas — o
 *    usuario nao rebalanceou. Calar para sempre seria o oposto do problema
 *    original. Passado o cooldown, o motor notifica de novo UMA vez e
 *    recarrega o relogio.
 *
 * O desarme (mecanismo 2) e o re-arme primario; o cooldown e o de reserva.
 * Foi essa a escolha entre os dois: o desarme e o unico que responde ao
 * fato do mundo real (a carteira voltou a meta) em vez de ao relogio, e nao
 * gasta uma notificacao para dizer o que o usuario acabou de fazer.
 *
 * BORDA DE DESCIDA: desarma e NAO notifica. "Voltou para dentro da meta"
 * nao e acionavel — o usuario que rebalanceou ja sabe, e quem voltou por
 * movimento de preco nao tem o que fazer com o aviso. Notificar nas duas
 * bordas dobraria o volume do canal para entregar metade da informacao.
 * O valor da descida e outro: e ela que rearma o alerta.
 */
export interface EdgeTriggerInput {
	/** Magnitude observada (sempre >= 0: desvio absoluto, queda em pontos). */
	magnitude: number;
	/** Acima disto a condicao esta ativa. */
	breachAt: number;
	/** Abaixo ou igual a isto a condicao desarma. `releaseAt <= breachAt`. */
	releaseAt: number;
	previous: ThresholdStateSnapshot | null;
	/** Re-arme por tempo, em horas. `<= 0` desliga o re-arme por cooldown. */
	cooldownHours: number;
	now: Date;
	/**
	 * Valor de referencia a gravar no proximo estado. Cada regra decide o
	 * que e referencia para ela (desvio corrente, pico de score, ...).
	 */
	referenceValue: number;
}

export interface EdgeTriggerDecision {
	outcome: ThresholdOutcome;
	reason: string;
	shouldNotify: boolean;
	nextState: ThresholdStateSnapshot;
}

/**
 * Fracao da banda que define a zona morta da histerese. 0,5 = para
 * desarmar, o desvio precisa cair para metade da banda. Escolhido em vez de
 * um valor absoluto para acompanhar a banda quando o usuario a configura:
 * quem afrouxa a banda afrouxa a zona morta junto, na mesma proporcao.
 */
export const RELEASE_BAND_FACTOR = 0.5;

export function decideEdge(input: EdgeTriggerInput): EdgeTriggerDecision {
	const nowIso = input.now.toISOString();
	const previous = input.previous;
	const wasBreaching = previous?.breaching === true;

	const base: ThresholdStateSnapshot = {
		breaching: wasBreaching,
		referenceValue: input.referenceValue,
		lastNotifiedAt: previous?.lastNotifiedAt ?? null,
		lastEvaluatedAt: nowIso,
	};

	// --- fora da banda -------------------------------------------------
	if (input.magnitude > input.breachAt) {
		if (!wasBreaching) {
			return {
				outcome: 'notify',
				reason: `borda de subida: ${round2(input.magnitude)} > ${round2(
					input.breachAt
				)}`,
				shouldNotify: true,
				nextState: {
					...base,
					breaching: true,
					lastNotifiedAt: nowIso,
				},
			};
		}

		const rearmed = cooldownExpired(
			previous?.lastNotifiedAt ?? null,
			input.cooldownHours,
			input.now
		);

		if (rearmed) {
			return {
				outcome: 'notify',
				reason: `condicao de pe ha mais de ${input.cooldownHours}h — re-arme por cooldown`,
				shouldNotify: true,
				nextState: { ...base, breaching: true, lastNotifiedAt: nowIso },
			};
		}

		return {
			outcome: 'suppressed_standing',
			reason: 'condicao ja estava ativa e o cooldown nao venceu',
			shouldNotify: false,
			nextState: { ...base, breaching: true },
		};
	}

	// --- dentro da zona morta (histerese) -------------------------------
	if (input.magnitude > input.releaseAt) {
		if (wasBreaching) {
			return {
				outcome: 'suppressed_standing',
				reason: `zona morta da histerese: ${round2(
					input.magnitude
				)} ainda acima de ${round2(input.releaseAt)} — segue armado`,
				shouldNotify: false,
				nextState: { ...base, breaching: true },
			};
		}
		return {
			outcome: 'suppressed_inside_band',
			reason: 'dentro da banda de tolerancia',
			shouldNotify: false,
			nextState: { ...base, breaching: false },
		};
	}

	// --- dentro da banda ------------------------------------------------
	if (wasBreaching) {
		return {
			outcome: 'cleared',
			reason: `borda de descida: ${round2(input.magnitude)} <= ${round2(
				input.releaseAt
			)} — desarmado, sem notificar`,
			shouldNotify: false,
			// Zerar `lastNotifiedAt` e o que RE-ARMA: a proxima subida volta a
			// ser uma borda, nao uma condicao de pe.
			nextState: { ...base, breaching: false, lastNotifiedAt: null },
		};
	}

	return {
		outcome: 'suppressed_inside_band',
		reason: 'dentro da banda de tolerancia',
		shouldNotify: false,
		nextState: { ...base, breaching: false, lastNotifiedAt: null },
	};
}

function cooldownExpired(
	lastNotifiedAt: string | null,
	cooldownHours: number,
	now: Date
): boolean {
	if (cooldownHours <= 0) return false;
	// Armado sem registro de disparo (estado vindo de versao anterior, ou
	// notificacao que falhou antes de gravar): tratar como "nunca notificou"
	// e deixar passar e mais util que calar para sempre.
	if (!lastNotifiedAt) return true;

	const last = new Date(lastNotifiedAt).getTime();
	if (Number.isNaN(last)) return true;

	return now.getTime() - last >= cooldownHours * 60 * 60 * 1000;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}
