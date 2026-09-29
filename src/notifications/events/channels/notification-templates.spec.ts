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
	'/ri-inteligente',
]);

const RI_DOCUMENT = {
	ticker: 'PETR4',
	company: 'Petrobras',
	title: 'Fato Relevante - Aquisição',
	publishedAt: '2026-09-28T00:00:00.000Z',
	sourceUrl:
		'https://www.rad.cvm.gov.br/ENETWeb/frmDownloadDocumento.aspx?Tela=ext&numProtocolo=1571942',
};

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
	{ type: NotificationType.RiMaterialFact, ...RI_DOCUMENT },
	{ type: NotificationType.RiDocument, ...RI_DOCUMENT },
];

describe('notification-templates — ctaPath aponta para rota que existe (25/09)', () => {
	it.each(SAMPLE_PAYLOADS.map((payload) => [payload.type, payload] as const))(
		'%s: ctaPath é uma rota real do web',
		(_type, payload) => {
			const { ctaPath } = buildTemplate(payload);
			// Corta querystring/params dinâmicos (:id) antes de comparar.
			const base =
				'/' +
				ctaPath.split('?')[0].split('/').filter(Boolean).slice(0, 1).join('/');
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

describe('notification-templates — documento de RI (TRA-261)', () => {
	const highlights = [
		'Aquisição de 30% do ativo X por US$ 1,2 bi.',
		'Fechamento previsto para o 1T27.',
	];

	it('fato relevante: assunto e abertura dizem o que aconteceu, com data', () => {
		const tpl = buildTemplate({
			type: NotificationType.RiMaterialFact,
			...RI_DOCUMENT,
		});

		expect(tpl.subject).toBe('Fato relevante de PETR4');
		expect(tpl.description).toBe(
			'Petrobras (PETR4) entregou à CVM em 28/09/2026: Fato Relevante - Aquisição.'
		);
		expect(tpl.ctaPath).toBe('/ri-inteligente?ticker=PETR4');
		expect(tpl.secondaryLink).toEqual({
			label: 'Abrir o documento na CVM',
			url: RI_DOCUMENT.sourceUrl,
		});
		// CVM 20: informativo, com fonte, sem recomendacao.
		expect(tpl.footerNote).toContain('não é recomendação de investimento');
		expect(tpl.textFallback).toContain(RI_DOCUMENT.sourceUrl);
	});

	it('outro documento tem copy propria', () => {
		const tpl = buildTemplate({
			type: NotificationType.RiDocument,
			...RI_DOCUMENT,
		});

		expect(tpl.subject).toBe('Novo documento de RI de PETR4');
		expect(tpl.title).toBe('Novo documento de PETR4');
	});

	// A abertura vem primeiro e sozinha: e ela que cabe na bandeja do push.
	it('destaques vem depois da abertura, no corpo e no texto puro', () => {
		const tpl = buildTemplate({
			type: NotificationType.RiMaterialFact,
			...RI_DOCUMENT,
			highlights,
		});

		expect(tpl.description.startsWith('Petrobras (PETR4) entregou')).toBe(true);
		expect(tpl.description).toContain(`Destaques: ${highlights.join(' • ')}`);
		expect(tpl.textFallback).toContain(`- ${highlights[1]}`);
	});

	it('codifica o ticker na rota', () => {
		const tpl = buildTemplate({
			type: NotificationType.RiDocument,
			...RI_DOCUMENT,
			ticker: 'TAEE11&x=1',
		});

		expect(tpl.ctaPath).toBe('/ri-inteligente?ticker=TAEE11%26x%3D1');
	});
});
