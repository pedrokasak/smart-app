import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest, RequestOptions } from 'node:https';
import type { B3InvestorConfig } from './b3-investor.config';

export interface B3HttpRequest {
	method: 'GET' | 'POST' | 'PATCH';
	url: string;
	headers?: Record<string, string>;
	query?: Record<string, string | number | undefined>;
	/** Corpo já serializado (ex.: form-urlencoded do token). */
	body?: string;
}

export interface B3HttpResponse {
	status: number;
	data: unknown;
}

/**
 * Transporte HTTP mínimo da integração B3. Responde qualquer status (quem
 * chama interpreta) e só lança em erro de rede, TLS ou timeout. Existe para
 * os testes não dependerem de rede nem de certificado de verdade.
 */
export interface B3HttpTransport {
	send(request: B3HttpRequest): Promise<B3HttpResponse>;
}

type TlsOptions = Pick<RequestOptions, 'cert' | 'key' | 'passphrase' | 'ca'>;

/** Teto de resposta: a B3 pagina de 20 em 20, então isso é folga grande. */
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

function buildUrl(request: B3HttpRequest): URL {
	const url = new URL(request.url);
	for (const [key, value] of Object.entries(request.query ?? {})) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}
	return url;
}

function parseBody(raw: string): unknown {
	if (!raw) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

/**
 * Usa `node:https` com as opções de TLS direto na requisição, e não um
 * `https.Agent` (que é o caminho do axios): o Bun, runtime de produção,
 * ignora `cert`/`key`/`ca` vindos de um Agent e a conexão mTLS falha.
 * Opções diretas funcionam no Node e no Bun (testado em 2026-10-28 com
 * Bun 1.2.4 contra um servidor que exige certificado de cliente).
 */
class NodeB3HttpTransport implements B3HttpTransport {
	constructor(
		private readonly timeoutMs: number,
		private readonly tls: TlsOptions = {}
	) {}

	send(request: B3HttpRequest): Promise<B3HttpResponse> {
		const url = buildUrl(request);
		const headers: Record<string, string | number> = { ...request.headers };
		if (request.body !== undefined) {
			headers['Content-Length'] = Buffer.byteLength(request.body);
		}
		const send = url.protocol === 'http:' ? httpRequest : httpsRequest;

		return new Promise((resolve, reject) => {
			const req = send(
				url,
				{
					method: request.method,
					headers,
					timeout: this.timeoutMs,
					...this.tls,
				},
				(res) => {
					const chunks: Buffer[] = [];
					let size = 0;
					res.on('data', (chunk: Buffer) => {
						size += chunk.length;
						if (size > MAX_RESPONSE_BYTES) {
							req.destroy(new Error('Resposta da B3 acima do limite'));
							return;
						}
						chunks.push(chunk);
					});
					res.on('end', () =>
						resolve({
							status: res.statusCode ?? 0,
							data: parseBody(Buffer.concat(chunks).toString('utf8')),
						})
					);
					res.on('error', reject);
				}
			);
			req.on('timeout', () =>
				req.destroy(new Error(`Timeout de ${this.timeoutMs}ms chamando a B3`))
			);
			req.on('error', reject);
			if (request.body !== undefined) req.write(request.body);
			req.end();
		});
	}
}

/** Transporte sem certificado, para o endpoint de token (Azure AD). */
export function createTokenTransport(
	config: B3InvestorConfig
): B3HttpTransport {
	return new NodeB3HttpTransport(config.timeoutMs);
}

/**
 * Transporte com Mutual TLS para as APIs da B3. O certificado e a chave do
 * pacote de acesso são lidos uma vez, no boot. A verificação do certificado
 * do servidor fica sempre ligada: se a B3 usar uma cadeia própria, informe
 * `B3_INVESTOR_CA_PATH` em vez de desligar a validação.
 */
export function createMutualTlsTransport(
	config: B3InvestorConfig
): B3HttpTransport {
	return new NodeB3HttpTransport(config.timeoutMs, {
		cert: readFileSync(config.certPath),
		key: readFileSync(config.keyPath),
		passphrase: config.keyPassphrase,
		ca: config.caPath ? readFileSync(config.caPath) : undefined,
	});
}
