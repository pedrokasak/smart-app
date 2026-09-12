import helmet from 'helmet';
import type { RequestHandler } from 'express';

/**
 * Content Security Policy da API (TRK-009).
 *
 * O CSP estava desligado (`contentSecurityPolicy: false`). Ele e a defesa em
 * profundidade que sobra quando uma injecao passa da validacao: sem ele,
 * qualquer XSS futuro vale sessao inteira, porque nada impede o script de
 * executar nem de exfiltrar para uma origem externa.
 *
 * Duas politicas, nao uma:
 *
 * 1. `apiCspDirectives` — vale para tudo que a API serve, que e JSON. Uma API
 *    que nao renderiza nada nao precisa carregar nada, entao o ponto de
 *    partida defensavel e `default-src 'none'`: nenhum script, nenhum estilo,
 *    nenhuma imagem, nenhuma conexao. Nao ha o que calibrar aqui.
 *
 * 2. `swaggerCspDirectives` — o Swagger UI e HTML de verdade e quebra sob a
 *    politica acima: o `@nestjs/swagger` injeta um `<script>` inline de
 *    inicializacao e a folha de estilo do swagger-ui usa estilo inline. Uma
 *    politica unica e apertada mataria a documentacao; uma politica unica e
 *    frouxa o bastante para o Swagger jogaria fora a protecao das rotas JSON.
 *    Por isso o afrouxamento fica ESCOPADO no path do Swagger, que so existe
 *    fora de producao (ou sob `ENABLE_SWAGGER=true`).
 *
 * MODO: report-only por padrao (`CSP_REPORT_ONLY` ausente ou !== 'false').
 * Subir direto em enforce e como times quebram funcionalidade legitima e
 * depois desligam o CSP para sempre. Report-only coleta violacao real
 * primeiro; promover para enforce vira mudanca de configuracao, nao de
 * codigo.
 *
 * SEM `report-uri` / `report-to` DE PROPOSITO: um endpoint de relatorio e um
 * POST nao autenticado que qualquer pagina na internet consegue fazer o
 * navegador da vitima disparar — amplificador de escrita gratuito, e um
 * caminho de DoS para o banco. Durante a janela de calibragem a violacao
 * aparece no console do navegador e no DevTools de quem abre o Swagger, que
 * e onde ela precisa aparecer. Se um dia houver coleta, ela deve nascer com
 * rate limit e sem persistencia direta do corpo enviado.
 */

/** Path onde o `SwaggerModule.setup` monta a UI (ver `main.ts`). */
export const SWAGGER_DOCS_PATH = 'api';

type CspDirectives = Record<string, string[] | string | null>;

/**
 * Politica das rotas JSON. `'none'` em tudo que importa; as diretivas
 * explicitas abaixo nao herdam de `default-src` e por isso sao repetidas.
 */
export const apiCspDirectives: CspDirectives = {
	'default-src': ["'none'"],
	// Impede que a resposta seja embutida em iframe de terceiro (clickjacking
	// sobre uma resposta JSON e raro, mas o custo de negar e zero).
	'frame-ancestors': ["'none'"],
	// Nao herda de default-src: sem isto, um `<base>` injetado reescreveria a
	// resolucao de qualquer URL relativa.
	'base-uri': ["'none'"],
	// Nao herda de default-src: bloqueia envio de formulario injetado.
	'form-action': ["'none'"],
	// Helmet adiciona `upgrade-insecure-requests` por padrao; mantido.
	'upgrade-insecure-requests': [],
};

/**
 * Politica do Swagger UI. `'unsafe-inline'` em script e estilo e uma divida
 * consciente: e o que o swagger-ui-dist exige hoje. Ela nao contamina as
 * rotas JSON porque este middleware so roda no path da documentacao, e o
 * Swagger nao fica ligado em producao por padrao (TRA-89).
 */
export const swaggerCspDirectives: CspDirectives = {
	'default-src': ["'none'"],
	'script-src': ["'self'", "'unsafe-inline'"],
	'style-src': ["'self'", "'unsafe-inline'"],
	'img-src': ["'self'", 'data:'],
	'font-src': ["'self'", 'data:'],
	// O "try it out" chama a propria API a partir da pagina.
	'connect-src': ["'self'"],
	'frame-ancestors': ["'none'"],
	'base-uri': ["'none'"],
	'form-action': ["'self'"],
	'upgrade-insecure-requests': [],
};

/**
 * Report-only e o padrao. So o literal 'false' promove para enforce — assim
 * uma variavel vazia, ausente ou com typo nunca liga o bloqueio sem querer.
 */
export function isCspReportOnly(env: NodeJS.ProcessEnv = process.env): boolean {
	return String(env.CSP_REPORT_ONLY ?? '').toLowerCase() !== 'false';
}

function cspMiddleware(
	directives: CspDirectives,
	reportOnly: boolean
): RequestHandler {
	return helmet.contentSecurityPolicy({
		useDefaults: false,
		directives,
		reportOnly,
	}) as unknown as RequestHandler;
}

export function isSwaggerRequest(path: string): boolean {
	const normalized = String(path || '').split('?')[0];
	return (
		normalized === `/${SWAGGER_DOCS_PATH}` ||
		normalized.startsWith(`/${SWAGGER_DOCS_PATH}/`) ||
		// O `SwaggerModule` serve os assets como `/api-<algo>.js|css` e o
		// spec como `/api-json`, irmãos do path e não filhos dele.
		normalized.startsWith(`/${SWAGGER_DOCS_PATH}-`)
	);
}

/**
 * Um único middleware que despacha por path, em vez de dois `app.use`.
 *
 * Com dois, a requisição do Swagger passaria pelos DOIS e o header ficaria
 * valendo o do último a rodar (`res.setHeader` substitui) — correto por
 * acidente de ordem. Aqui a escolha é explícita e testável sem servidor.
 */
export function buildCspMiddleware(reportOnly: boolean): RequestHandler {
	const api = cspMiddleware(apiCspDirectives, reportOnly);
	const swagger = cspMiddleware(swaggerCspDirectives, reportOnly);
	return (req, res, next) =>
		isSwaggerRequest(req.path ?? req.url)
			? swagger(req, res, next)
			: api(req, res, next);
}
