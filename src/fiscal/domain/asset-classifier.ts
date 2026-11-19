/**
 * Classe fiscal de um ativo (TRA-287).
 *
 * A categoria decide a alíquota e a isenção da venda:
 *  - `stock`: ações (inclui units). 15%, e as vendas do mês até R$ 20.000 são
 *    isentas (Lei 11.033/2004, art. 2º e 3º).
 *  - `etf`: ETF de renda variável. 15%, sem a isenção de R$ 20.000, que é só
 *    de ações. Compensa prejuízo no mesmo grupo das ações.
 *  - `fii`: fundo imobiliário. 20%, sem isenção (Lei 8.668/1993, art. 18).
 *  - `crypto`: criptoativos.
 *
 * O ticker sozinho não diz a classe: o sufixo 11 é de FII, de ETF e de unit
 * (certificado de depósito de ações). Antes, `/11$/` mandava tudo para FII, e
 * `BOVA11` pagava 20% enquanto `SANB11` perdia a isenção. Como a importação da
 * B3 também grava `type: 'fii'` para todo ticker com 11, o tipo gravado no
 * ativo não é confiável para esses casos: os catálogos abaixo valem mais que
 * ele. A solução definitiva é gravar o tipo certo na importação, a partir de
 * fonte autoritativa (TRA-95); até lá, esta função corrige no cálculo, sem
 * mexer em dado nem em cotação.
 */
export type FiscalCategory = 'stock' | 'fii' | 'etf' | 'crypto';

/**
 * ETFs de renda variável negociados em bolsa. A lista só tem fundos de índice
 * de ações e de ativos digitais cuja natureza é certa: errar para o lado do
 * ETF num FII de verdade trocaria 20% por 15%, e o oposto trocaria o ETF por
 * FII. ETFs de renda fixa (IMAB11, IRFM11 e afins) ficam de fora de propósito,
 * porque a tributação deles é outra e não foi confirmada.
 */
export const KNOWN_ETF_TICKERS: ReadonlySet<string> = new Set([
	'BOVA11',
	'BOVV11',
	'BRAX11',
	'SMAL11',
	'IVVB11',
	'SPXI11',
	'NASD11',
	'DIVO11',
	'FIND11',
	'MATB11',
	'ISUS11',
	'ECOO11',
	'GOVE11',
	'PIBB11',
	'XINA11',
	'ACWI11',
	'EURP11',
	'GOLD11',
	'HASH11',
	'QBTC11',
	'ETHE11',
]);

/**
 * Units: certificados de depósito de ações, tratados como ações. Decisão da
 * TRA-236 ("units continuam isentas"); a confirmação com contador está na
 * TRA-46.
 */
export const KNOWN_UNIT_TICKERS: ReadonlySet<string> = new Set([
	'SANB11',
	'TAEE11',
	'KLBN11',
	'ALUP11',
	'BPAC11',
	'SAPR11',
	'ENGI11',
	'IGTI11',
	'BIDI11',
	'TIET11',
	'SULA11',
	'GETT11',
]);

function normalizeTicker(symbol: string): string {
	return String(symbol || '')
		.trim()
		.toUpperCase()
		.replace(/\.SA$/, '');
}

/**
 * Ordem de decisão:
 *  1. Cripto explícita é cripto.
 *  2. Catálogo de ETF e de unit vence o tipo gravado: um ETF nunca é FII, e o
 *     tipo `fii` vem de uma importação que chutava pelo sufixo.
 *  3. `fii` e `etf` explícitos são respeitados.
 *  4. Ticker com 11 fora dos catálogos, sem tipo ou como `stock`, segue como
 *     FII. É o comportamento de antes, e é o lado seguro: nunca dá a isenção
 *     das ações por engano.
 *  5. O resto é ação.
 */
export function classifyFiscalCategory(
	symbol: string,
	explicitType?: string
): FiscalCategory {
	const ticker = normalizeTicker(symbol);
	const type = String(explicitType || '')
		.trim()
		.toLowerCase();

	if (type === 'crypto') return 'crypto';
	if (KNOWN_ETF_TICKERS.has(ticker)) return 'etf';
	if (KNOWN_UNIT_TICKERS.has(ticker)) return 'stock';
	if (type === 'fii') return 'fii';
	if (type === 'etf') return 'etf';
	if (/11$/.test(ticker)) return 'fii';
	return 'stock';
}
