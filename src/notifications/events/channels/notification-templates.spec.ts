import { buildTemplate } from './notification-templates';
import {
	NotificationPayload,
	NotificationType,
} from '../domain/notification.types';

/**
 * Rotas reais do `web` (App.tsx) que uma notificação pode legitimamente
 * apontar. Existe pra pegar exatamente o bug de 25/09: `ctaPath` apontava
 * para `/dashboard/proventos`, `/dashboard/carteira` e `/dashboard/insights`
 * — nenhuma delas jamais existiu no roteador, e o clique na notificação de
 * dividendo caía em 404.
 *
 * Lista fechada de propósito: uma rota nova em `App.tsx` precisa ser
 * adicionada aqui também, o que força quem mexe num template a checar se a
 * rota que está digitando existe de verdade.
 */
const REAL_WEB_ROUTES = new Set([
	'/dashboard',
	'/portfolio',
	'/dividends',
	'/ai-insights',
	'/subscription',
	'/fiscal',
	'/reports',
]);

const SAMPLE_PAYLOADS: NotificationPayload[] = [
	{
		type: NotificationType.DividendReceived,
		symbol: 'ALPA3',
		amount: 12.5,
		currency: 'BRL',
		receivedAt: '2026-09-24T00:00:00.000Z',
	},
	{
		type: NotificationType.AllocationBreached,
		bucket: 'stocks',
		targetPct: 40,
		actualPct: 55,
	},
	{
		type: NotificationType.PortfolioScoreDropped,
		score: 60,
		previousScore: 80,
		dropPoints: 20,
		maxScore: 100,
	},
	{
		type: NotificationType.AiInsightHigh,
		title: 'Concentração em um único setor',
		summary: 'Sua carteira está 70% em um único setor.',
		insightId: 'insight-123',
	},
	{
		type: NotificationType.AiInsightHigh,
		title: 'Concentração em um único setor',
		summary: 'Sua carteira está 70% em um único setor.',
		// Sem insightId: o outro ramo do `ctaPath` condicional.
	},
	{
		type: NotificationType.QuoteStale,
		symbol: 'PETR4',
		minutesSinceLastQuote: 4320,
		lastQuoteAt: '2026-09-20T00:00:00.000Z',
	},
	{
		type: NotificationType.SubscriptionExpiring,
		planName: 'Wealth',
		expiresAt: '2026-10-01T00:00:00.000Z',
		daysUntilExpiration: 6,
	},
];

describe('notification-templates — ctaPath aponta para rota que existe (25/09)', () => {
	it.each(SAMPLE_PAYLOADS.map((payload) => [payload.type, payload] as const))(
		'%s: ctaPath é uma rota real do web',
		(_type, payload) => {
			const { ctaPath } = buildTemplate(payload);
			// Corta querystring/params dinâmicos (:id) antes de comparar.
			const base =
				'/' + ctaPath.split('/').filter(Boolean).slice(0, 1).join('/');
			expect(REAL_WEB_ROUTES.has(base)).toBe(true);
		}
	);

	it('nenhum ctaPath usa o prefixo /dashboard/ inventado', () => {
		for (const payload of SAMPLE_PAYLOADS) {
			expect(buildTemplate(payload).ctaPath).not.toMatch(/^\/dashboard\//);
		}
	});

	it('dividendo recebido leva para /dividends, não /dashboard/proventos', () => {
		const { ctaPath } = buildTemplate(SAMPLE_PAYLOADS[0]);
		expect(ctaPath).toBe('/dividends');
	});
});
