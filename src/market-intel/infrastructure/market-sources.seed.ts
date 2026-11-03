import { MarketSource } from 'src/market-intel/domain/market-intel.types';

/**
 * Fontes iniciais de RSS (ADR-004 seção 6, decidido em 02/11/2026).
 *
 * Camada A (fontes oficiais): texto completo com atribuição.
 * Camada B (portais privados): RSS com título, descrição ≤300 chars, link.
 *
 * NUNCA exibir notícias ao usuário — contexto interno do RAG apenas.
 */
export const INITIAL_MARKET_SOURCES: Omit<
	MarketSource,
	'lastFetchedAt' | 'etag' | 'lastModified'
>[] = [
	// ── Camada A — Fontes oficiais ────────────────────────────────────────────
	{
		id: 'cvm-oficial',
		name: 'CVM — Comunicados oficiais',
		feedUrl: 'https://www.gov.br/cvm/pt-br/assuntos/noticias/RSS',
		layer: 'A',
		enabled: true,
		domain: 'www.gov.br',
	},
	{
		id: 'bcb-notas',
		name: 'Banco Central — Notas e comunicados',
		feedUrl: 'https://www.bcb.gov.br/api/feed/pt-br/noticias',
		layer: 'A',
		enabled: true,
		domain: 'www.bcb.gov.br',
	},
	{
		id: 'b3-noticias',
		name: 'B3 — Notícias',
		feedUrl: 'https://www.b3.com.br/pt_br/noticias/feed.xml',
		layer: 'A',
		enabled: true,
		domain: 'www.b3.com.br',
	},
	{
		id: 'agencia-brasil',
		name: 'Agência Brasil — Economia',
		feedUrl: 'https://agenciabrasil.ebc.com.br/rss/economia/feed.xml',
		layer: 'A',
		enabled: true,
		domain: 'agenciabrasil.ebc.com.br',
	},
	{
		id: 'ibge-noticias',
		name: 'IBGE — Notícias',
		feedUrl: 'https://agenciadenoticias.ibge.gov.br/feed',
		layer: 'A',
		enabled: true,
		domain: 'agenciadenoticias.ibge.gov.br',
	},
	{
		id: 'tesouro-nacional',
		name: 'Tesouro Nacional — Notícias',
		feedUrl: 'https://www.tesouronacional.gov.br/rss',
		layer: 'A',
		enabled: true,
		domain: 'www.tesouronacional.gov.br',
	},
	// ── Camada B — Portais privados (RSS resumido) ───────────────────────────
	{
		id: 'infomoney',
		name: 'InfoMoney',
		feedUrl: 'https://www.infomoney.com.br/feed/',
		layer: 'B',
		enabled: true,
		domain: 'www.infomoney.com.br',
	},
	{
		id: 'money-times',
		name: 'Money Times',
		feedUrl: 'https://www.moneytimes.com.br/feed/',
		layer: 'B',
		enabled: true,
		domain: 'www.moneytimes.com.br',
	},
	{
		id: 'e-investidor',
		name: 'E-Investidor (Estadão)',
		feedUrl: 'https://einvestidor.estadao.com.br/feed/',
		layer: 'B',
		enabled: true,
		domain: 'einvestidor.estadao.com.br',
	},
	{
		id: 'seu-dinheiro',
		name: 'Seu Dinheiro',
		feedUrl: 'https://www.seudinheiro.com/feed/',
		layer: 'B',
		enabled: true,
		domain: 'www.seudinheiro.com',
	},
];
