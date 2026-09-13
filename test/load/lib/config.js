/**
 * Configuracao compartilhada dos cenarios k6 (TRA-xxx, harness de carga).
 *
 * Este arquivo e JavaScript, nao TypeScript, de proposito: os scripts rodam
 * no runtime do k6 (goja), com imports proprios (`k6/http`, `k6/metrics`)
 * que o `tsconfig.json` e o eslint deste repo nao resolvem. Deixando-os
 * como `.js` fora do glob `{src,apps,libs,test}/**\/*.ts`, o `lint:check` e
 * o `type-check` do CI continuam passando sem que ninguem precise adicionar
 * excecao ou dependencia.
 *
 * REGRA DE SEGURANCA CENTRAL: o alvo default e localhost. Apontar para
 * qualquer outro host exige DUAS variaveis — a URL e um reconhecimento
 * explicito de risco. Um teste de estresse contra producao esgota conexoes
 * do Mongo, enche a fila e, dependendo do cenario, dispara notificacao real
 * para usuario real. Isso precisa ser um ato deliberado.
 */

const DEFAULT_BASE_URL = 'http://localhost:3000';

/** Valor exato exigido em LOAD_ALLOW_REMOTE para liberar host remoto. */
const REMOTE_ACK = 'i-understand-the-risk';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'];

function hostOf(url) {
	// Sem URL/WHATWG no goja em versoes antigas do k6; regex basta e nao
	// depende de polyfill.
	const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/.exec(url);
	if (!match) return '';
	const authority = match[1];
	const hostPort = authority.indexOf('@') >= 0
		? authority.slice(authority.indexOf('@') + 1)
		: authority;
	// Remove a porta, preservando IPv6 entre colchetes.
	if (hostPort.charAt(0) === '[') {
		const close = hostPort.indexOf(']');
		return close > 0 ? hostPort.slice(0, close + 1) : hostPort;
	}
	const colon = hostPort.lastIndexOf(':');
	return colon > 0 ? hostPort.slice(0, colon) : hostPort;
}

export function isLocalTarget(url) {
	const host = hostOf(url).toLowerCase();
	return LOCAL_HOSTS.indexOf(host) >= 0;
}

/**
 * Resolve a URL alvo e barra host remoto sem reconhecimento explicito.
 * Lanca no contexto de init, que aborta o run antes de qualquer requisicao.
 */
export function baseUrl() {
	const url = (__ENV.LOAD_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

	if (!isLocalTarget(url) && __ENV.LOAD_ALLOW_REMOTE !== REMOTE_ACK) {
		throw new Error(
			`\n\n  ALVO REMOTO BLOQUEADO: ${url}\n\n` +
				`  Este harness so aponta para localhost por default. Para atingir um\n` +
				`  host remoto (staging ou producao) rode com:\n\n` +
				`      -e LOAD_ALLOW_REMOTE=${REMOTE_ACK}\n\n` +
				`  Antes de fazer isso, leia a secao "Riscos" do test/load/README.md.\n` +
				`  Uma rampa de estresse contra producao esgota conexoes do Mongo,\n` +
				`  enche a fila de eventos e pode disparar notificacao para usuario real.\n`
		);
	}

	return url;
}

/** Numero de VUs do plateau. Todos os perfis de rampa derivam deste valor. */
export function targetVus(fallback) {
	const raw = Number(__ENV.LOAD_VUS || fallback);
	if (!isFinite(raw) || raw < 1) {
		throw new Error(`LOAD_VUS invalido: ${__ENV.LOAD_VUS}`);
	}
	return Math.floor(raw);
}

/** Duracao do plateau. Rampas de subida/descida sao proporcionais fixas. */
export function plateau(fallback) {
	return __ENV.LOAD_PLATEAU || fallback;
}

/**
 * Perfil de rampa realista: sobe em dois degraus, mantem, e desce.
 *
 * Um `constant-vus` chapado mede um regime que nao existe em producao — o
 * pool de conexoes do Mongo e o cache do Node nascem frios, e a subida
 * instantanea confunde "custo de warm-up" com "custo em carga". Os degraus
 * separam as duas coisas na leitura do grafico.
 */
export function rampProfile(vus, plateauDuration) {
	const half = Math.max(1, Math.floor(vus / 2));
	return [
		{ duration: '30s', target: half },
		{ duration: '30s', target: vus },
		{ duration: plateauDuration, target: vus },
		{ duration: '30s', target: 0 },
	];
}

/**
 * User-Agent por VU.
 *
 * O `EndpointRateLimitMiddleware` identifica o cliente por
 * sha256(ip | user-agent | accept-language) e limita `POST /auth/signin` a
 * 12/min. Uma maquina de carga tem UM ip: sem variar o fingerprint, o
 * cenario de autenticacao para de medir o argon2 e passa a medir o rate
 * limiter — a partir da 13a requisicao do minuto tudo vira 429.
 *
 * Variar o User-Agent por VU reproduz o que 5 mil usuarios reais, com IPs
 * distintos, produziriam: buckets separados. E uma acomodacao do TESTE, nao
 * uma mudanca do produto — e esta documentada no README junto com a
 * limitacao real que ela expoe (o limitador e por processo, em memoria).
 *
 * LOAD_UA_MODE=fixed inverte isso de proposito: todos os VUs compartilham o
 * fingerprint e o run passa a medir o proprio rate limiter.
 */
export function vuUserAgent(vuId) {
	if (__ENV.LOAD_UA_MODE === 'fixed') {
		return 'trackerr-load/1.0 (fixed-fingerprint)';
	}
	return `trackerr-load/1.0 (vu=${vuId})`;
}

export function jsonHeaders(vuId) {
	return {
		'Content-Type': 'application/json',
		Accept: 'application/json',
		'User-Agent': vuUserAgent(vuId),
	};
}

export function authHeaders(token, vuId) {
	const headers = jsonHeaders(vuId);
	headers.Authorization = `Bearer ${token}`;
	return headers;
}

/** Resumo impresso no inicio de cada run — evita rodar contra o alvo errado. */
export function banner(scenarioName, url, vus) {
	const scope = isLocalTarget(url) ? 'LOCAL' : 'REMOTO';
	return (
		`\n[${scenarioName}] alvo=${url} (${scope}) vus=${vus} ` +
		`ua=${__ENV.LOAD_UA_MODE === 'fixed' ? 'fixo' : 'por-vu'}\n`
	);
}
