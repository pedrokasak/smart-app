import { NotificationPayload } from 'src/notifications/events/domain/notification.types';
import { buildTemplate } from 'src/notifications/events/channels/notification-templates';
import {
	MAX_PUSH_PAYLOAD_PLAINTEXT_BYTES,
	WebPushPayload,
} from '../domain/push.types';

/** Teto do texto do corpo. Android/iOS truncam bem antes disso na bandeja. */
const MAX_BODY_CHARS = 120;

/** Rota do painel quando o resumo cobre eventos de naturezas diferentes. */
const FALLBACK_ROUTE = '/dashboard';

function truncate(text: string, max: number): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Uma chave por dia: o SO colapsa o aviso de hoje sobre o de ontem. */
export function digestTag(reference: Date): string {
	return `trackerr-daily-${reference.toISOString().slice(0, 10)}`;
}

/**
 * Monta o resumo diario a partir das notificacoes do dia.
 *
 * Duas regras de copy, e so duas:
 *
 *   - UMA notificacao -> o push repete o titulo dela e leva direto ao CTA
 *     daquele evento. Agregar "1 novidade" seria esconder informacao que
 *     ja cabia na tela.
 *   - VARIAS -> contagem ("3 novidades na sua carteira") e rota do painel.
 *     Nao listamos os titulos: o payload tem teto de ~4KB e, mais
 *     importante, ninguem le tres paragrafos numa bandeja de notificacao.
 *
 * O corpo NUNCA carrega valores financeiros do usuario alem do que a copy
 * deterministica ja mostraria — o push aparece na tela de bloqueio, que e
 * o lugar menos privado do aparelho.
 *
 * Devolve `null` quando nao ha nada a dizer. Push vazio e spam.
 */
export function buildPushDigest(
	payloads: NotificationPayload[],
	reference: Date
): WebPushPayload | null {
	if (payloads.length === 0) return null;

	const tag = digestTag(reference);

	if (payloads.length === 1) {
		const tpl = buildTemplate(payloads[0]);
		return capped({
			title: truncate(tpl.title, MAX_BODY_CHARS),
			body: truncate(tpl.description, MAX_BODY_CHARS),
			tag,
			url: tpl.ctaPath,
			count: 1,
		});
	}

	return capped({
		title: 'Trakker',
		body: `${payloads.length} novidades na sua carteira`,
		tag,
		url: FALLBACK_ROUTE,
		count: payloads.length,
	});
}

/**
 * Ultima linha de defesa contra estourar o limite do push service. Um
 * titulo vindo de `AiInsightHigh` e texto livre — improvavel, mas nao
 * impossivel de crescer. Se ainda assim passar, cai para a forma agregada,
 * que tem tamanho conhecido.
 */
function capped(payload: WebPushPayload): WebPushPayload {
	const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
	if (bytes <= MAX_PUSH_PAYLOAD_PLAINTEXT_BYTES) return payload;

	return {
		title: 'Trakker',
		body: `${payload.count} novidade${payload.count === 1 ? '' : 's'} na sua carteira`,
		tag: payload.tag,
		url: FALLBACK_ROUTE,
		count: payload.count,
	};
}
