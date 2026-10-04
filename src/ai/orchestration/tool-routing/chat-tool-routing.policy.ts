import { ChatOrchestratorIntent } from 'src/ai/orchestration/chat-orchestrator.types';

/**
 * Quando o roteador com tool-calling entra (TRA-241). O regex é o caminho
 * rápido — sem custo e sem latência — e continua respondendo tudo que já
 * reconhece. O LLM só é chamado em dois casos:
 *
 * - `unknown`: o regex não reconheceu nada. Antes, a resposta era um
 *   genérico "organizei os fatos no painel".
 * - `multi_intent`: a pergunta pede duas coisas ("compare PETR4 e VALE3 e
 *   diga o impacto no meu risco"), e o regex, que escolhe a primeira regra
 *   que casa, responde só uma.
 *
 * Conversa sem intenção de negócio ("oi, tudo bem?") não paga LLM.
 */
export type ChatToolRoutingTrigger = 'unknown' | 'multi_intent';

function fold(value: string): string {
	return String(value || '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

const SMALL_TALK =
	/^(oi|ola|opa|e ai|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|tudo bem|tchau|ate mais|teste)\b/;

/** Famílias de assunto: duas na mesma pergunta indicam dois pedidos. */
const SIGNAL_FAMILIES: readonly RegExp[] = [
	/\b(compar\w*|versus|vs)\b/,
	/\b(risco\w*|volatil\w*|concentr\w*|exposic\w*)\b/,
	/\b(dividend\w*|provento\w*|jcp)\b/,
	/\b(impost\w*|darf|tribut\w*)\b/,
	/\b(vend\w*)\b/,
	/\b(cdi|ibov\w*|benchmark)\b/,
	/\b(futur\w*|projec\w*|daqui a \d+)\b/,
	/\b(fato relevante|release|itr|dfp|relacoes com investidores)\b/,
	/\b(aporte\w*|aportar|rebalance\w*|fora da meta|fora do alvo)\b/,
	/\b(oportunidade\w*)\b/,
	/\b(correla\w*)\b/,
];

/**
 * Ligação entre dois pedidos. Sem ela, duas famílias costumam ser UM pedido
 * só ("o que a PETR4 disse sobre dividendos no último ITR?", "quanto vou
 * pagar de imposto se vender?") — e o regex já acerta esses.
 */
const SECOND_REQUEST =
	/\b(tambem|alem d[eo]|e (diga|me diga|mostre|me mostre|qual|quais|quanto|como|veja|calcule|compare|simule|depois))\b|;/;

export function hasMultipleRequests(question: string): boolean {
	const text = fold(question);
	if (!SECOND_REQUEST.test(text)) return false;
	return SIGNAL_FAMILIES.filter((family) => family.test(text)).length >= 2;
}

export function isSmallTalk(question: string): boolean {
	const text = fold(question);
	return text.length < 4 || (text.length < 40 && SMALL_TALK.test(text));
}

export function toolRoutingTrigger(
	question: string,
	regexIntent: ChatOrchestratorIntent
): ChatToolRoutingTrigger | null {
	if (isSmallTalk(question)) return null;
	if (regexIntent === 'unknown') return 'unknown';
	// Recusa honesta e análise estratégica (narrativa) ficam como estão.
	if (
		regexIntent === 'narrative_synthesis' ||
		regexIntent === 'unsupported_quant_analysis' ||
		regexIntent === 'market_screening'
	) {
		return null;
	}
	return hasMultipleRequests(question) ? 'multi_intent' : null;
}
