import {
	NotificationPayload,
	NotificationType,
} from '../domain/notification.types';

export type NotificationTemplate = {
	subject: string;
	title: string;
	hero: string;
	description: string;
	ctaLabel: string;
	ctaPath: string; // caminho relativo — o canal prefixa com base url
	footerNote: string;
	textFallback: string;
};

const money = (value: number, currency = 'BRL') =>
	new Intl.NumberFormat('pt-BR', {
		style: 'currency',
		currency,
	}).format(value);

const fmtDate = (iso: string) => {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat('pt-BR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	}).format(d);
};

/**
 * Registro de templates por tipo. Puro: recebe o payload tipado, devolve
 * o template pronto pra qualquer canal. Sem HTML aqui — cada canal decide
 * como renderizar (o email usa o base template do EmailService).
 */
export function buildTemplate(
	payload: NotificationPayload
): NotificationTemplate {
	switch (payload.type) {
		case NotificationType.DividendReceived:
			return {
				subject: `Dividendo recebido: ${payload.symbol}`,
				title: `Novo dividendo de ${payload.symbol}`,
				hero: 'Voce recebeu um novo provento',
				description: `Foi creditado ${money(payload.amount, payload.currency ?? 'BRL')} de ${payload.symbol}${
					payload.receivedAt ? ` em ${fmtDate(payload.receivedAt)}` : ''
				}. Confira o extrato de proventos da sua carteira.`,
				ctaLabel: 'Ver proventos',
				ctaPath: '/dashboard/proventos',
				footerNote:
					'Voce recebe este e-mail porque ativou avisos de dividendos nas suas preferencias.',
				textFallback: `Novo dividendo: ${payload.symbol} — ${money(
					payload.amount,
					payload.currency ?? 'BRL'
				)}${payload.receivedAt ? ` em ${fmtDate(payload.receivedAt)}` : ''}.`,
			};
		case NotificationType.AllocationBreached:
			return {
				subject: `Meta de alocacao estourada: ${payload.bucket}`,
				title: `Alocacao acima da meta em ${payload.bucket}`,
				hero: 'Sua carteira saiu da meta',
				description: `Sua exposicao em ${payload.bucket} esta em ${payload.actualPct.toFixed(
					1
				)}%, contra uma meta de ${payload.targetPct.toFixed(1)}%. Vale rebalancear.`,
				ctaLabel: 'Ver alocacao',
				ctaPath: '/dashboard/carteira',
				footerNote:
					'Voce recebe este e-mail porque ativou alertas de meta de alocacao.',
				textFallback: `Alocacao em ${payload.bucket}: ${payload.actualPct.toFixed(
					1
				)}% (meta ${payload.targetPct.toFixed(1)}%).`,
			};
		case NotificationType.PortfolioScoreDropped:
			return {
				subject: `Seu score de diversificacao caiu ${payload.dropPoints.toFixed(0)} pontos`,
				title: 'Queda no score de diversificacao',
				hero: 'Sua carteira ficou menos diversificada',
				description: `O score de diversificacao da sua carteira caiu de ${payload.previousScore.toFixed(
					0
				)} para ${payload.score.toFixed(0)} (de ${payload.maxScore.toFixed(
					0
				)}), uma queda de ${payload.dropPoints.toFixed(
					0
				)} pontos. Vale conferir se a concentracao aumentou em algum ativo ou setor.`,
				ctaLabel: 'Ver carteira',
				ctaPath: '/dashboard/carteira',
				footerNote:
					'Voce recebe este e-mail porque ativou alertas de queda de score da carteira.',
				textFallback: `Score de diversificacao: ${payload.score.toFixed(
					0
				)} (era ${payload.previousScore.toFixed(
					0
				)}), queda de ${payload.dropPoints.toFixed(0)} pontos.`,
			};
		case NotificationType.AiInsightHigh:
			return {
				subject: `Insight IA: ${payload.title}`,
				title: payload.title,
				hero: 'Novo insight de alta prioridade',
				description: payload.summary,
				ctaLabel: 'Abrir insight',
				ctaPath: payload.insightId
					? `/dashboard/insights/${payload.insightId}`
					: '/dashboard/insights',
				footerNote:
					'Voce recebe este e-mail porque ativou avisos de insights IA de alta prioridade.',
				textFallback: `${payload.title}\n\n${payload.summary}`,
			};
		case NotificationType.QuoteStale:
			return {
				subject: `Cotacao sem atualizacao: ${payload.symbol}`,
				title: `Cotacao de ${payload.symbol} sumiu`,
				hero: 'Detectamos atraso na cotacao',
				description: `A cotacao de ${payload.symbol} nao atualiza ha ${payload.minutesSinceLastQuote} minutos. Isso pode ser instabilidade da fonte de dados.`,
				ctaLabel: 'Ver carteira',
				ctaPath: '/dashboard/carteira',
				footerNote:
					'Voce recebe este e-mail porque ativou alertas de cotacao ausente.',
				textFallback: `Cotacao ${payload.symbol} sem atualizacao ha ${payload.minutesSinceLastQuote} min.`,
			};
		case NotificationType.SubscriptionExpiring:
			return {
				subject: `Sua assinatura ${payload.planName} expira em ${payload.daysUntilExpiration} dia(s)`,
				title: `Renove sua assinatura ${payload.planName}`,
				hero: 'Sua assinatura esta acabando',
				description: `Sua assinatura ${payload.planName} expira em ${fmtDate(
					payload.expiresAt
				)} (${payload.daysUntilExpiration} dia(s)). Renove agora pra manter o acesso aos recursos premium.`,
				ctaLabel: 'Renovar assinatura',
				ctaPath: '/subscription',
				footerNote:
					'Voce nao pode desativar este aviso — e essencial para o funcionamento da assinatura.',
				textFallback: `Sua assinatura ${payload.planName} expira em ${fmtDate(
					payload.expiresAt
				)} (${payload.daysUntilExpiration} dia(s)).`,
			};
	}
}
