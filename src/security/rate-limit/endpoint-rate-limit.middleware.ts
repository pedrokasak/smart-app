import {
	HttpException,
	HttpStatus,
	Inject,
	Injectable,
	NestMiddleware,
	Optional,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import {
	RATE_LIMIT_STORE,
	RateLimitStore,
} from 'src/security/rate-limit/application/ports/rate-limit-store.port';
import { InMemoryRateLimitStore } from 'src/security/rate-limit/infrastructure/in-memory-rate-limit.store';

type RateLimitRule = {
	limit: number;
	windowMs: number;
};

@Injectable()
export class EndpointRateLimitMiddleware implements NestMiddleware {
	private readonly defaultRule: RateLimitRule = {
		limit: 300,
		windowMs: 60_000,
	};
	private readonly rules: Record<string, RateLimitRule> = {
		'POST:/auth/signin': { limit: 12, windowMs: 60_000 },
		'POST:/auth/google/signin': { limit: 12, windowMs: 60_000 },
		'POST:/auth/forgot-password': { limit: 8, windowMs: 60_000 },
		'POST:/auth/reset-password': { limit: 10, windowMs: 60_000 },
		// Código TOTP tem 6 dígitos: no limite padrão de 300/min a força
		// bruta cabe dentro da janela de validade do código (TRA-89).
		'POST:/auth/2fa/authenticate': { limit: 5, windowMs: 60_000 },
		'POST:/auth/2fa/verify': { limit: 5, windowMs: 60_000 },
		'DELETE:/auth/2fa/disable': { limit: 5, windowMs: 60_000 },
		// Códigos de recuperação. O consumo é um *bypass* do segundo
		// fator e não tem guard — mesma posição de `/auth/2fa/authenticate` —,
		// então não pode ser mais frouxo que ele: mesmos 5/min. A geração
		// exige TOTP válido e o mesmo teto vale como anti-automação; o status
		// é leitura sem segredo e fica mais folgado, só para não virar um
		// canal de polling barato contra o banco.
		'POST:/auth/2fa/recovery-codes/generate': { limit: 5, windowMs: 60_000 },
		'POST:/auth/2fa/recovery-codes/consume': { limit: 5, windowMs: 60_000 },
		'GET:/auth/2fa/recovery-codes/status': { limit: 30, windowMs: 60_000 },
		'POST:/broker-sync/upload-note': { limit: 20, windowMs: 10 * 60_000 },
		'POST:/leads/purchase-intent': { limit: 5, windowMs: 60_000 },
		// Cada chamada destas custa uma requisição paga de LLM.
		'POST:/ai/chat': { limit: 20, windowMs: 60_000 },
		'POST:/ai/chat/intelligent': { limit: 20, windowMs: 60_000 },
		'POST:/ai/analyze': { limit: 20, windowMs: 60_000 },
	};

	private readonly store: RateLimitStore;

	/**
	 * A store é opcional no construtor para que o middleware continue
	 * instanciável sem container — é assim que os testes o exercitam, e o
	 * default (contador em memória) é o mesmo comportamento de antes da
	 * TRA-138. Em produção o RateLimitModule injeta a implementação Redis.
	 */
	constructor(@Optional() @Inject(RATE_LIMIT_STORE) store?: RateLimitStore) {
		this.store = store ?? new InMemoryRateLimitStore();
	}

	/**
	 * Janela FIXA (não deslizante), preservada da implementação anterior: a
	 * janela nasce na primeira requisição do par rota+fingerprint, vale
	 * `windowMs`, e ao expirar a contagem recomeça do zero. Trocar para
	 * sliding window mudaria quantas tentativas cabem na virada da janela —
	 * a TRA-138 muda ONDE o contador mora, não a política.
	 *
	 * `async` porque o contador agora pode estar em outro processo. O Nest
	 * aguarda o middleware e trata a exceção lançada aqui pelo mesmo caminho
	 * de antes (RouterProxy -> ExceptionsHandler), então a resposta 429 e o
	 * header `Retry-After` continuam idênticos.
	 */
	async use(req: Request, res: Response, next: NextFunction): Promise<void> {
		const routeKey = `${req.method.toUpperCase()}:${req.path}`;
		const rule = this.rules[routeKey] || this.defaultRule;
		const fingerprint = this.buildFingerprint(req);
		const key = `${routeKey}:${fingerprint}`;

		const hit = await this.store.hit(key, rule.windowMs);

		// FAIL OPEN. Sem contador não há decisão informada a tomar, e recusar
		// tudo transformaria uma piscada do Redis em queda do login. Quem
		// derrubar o armazenamento ganha uma janela sem limite: é o custo
		// aceito, e o adaptador loga a degradação (uma vez, não por request).
		if (hit.outcome === 'unavailable') {
			return next();
		}

		if (hit.count > rule.limit) {
			const retryAfterSeconds = Math.max(1, Math.ceil(hit.resetInMs / 1000));
			res.setHeader('Retry-After', String(retryAfterSeconds));
			throw new HttpException(
				`Rate limit excedido para este endpoint. Tente novamente em ${retryAfterSeconds}s.`,
				HttpStatus.TOO_MANY_REQUESTS
			);
		}

		next();
	}

	/**
	 * Identifica o cliente para efeito de limite (TRA-89).
	 *
	 * O IP vem de `req.ip`, que respeita a configuração `trust proxy` do
	 * Express — ou seja, só considera `x-forwarded-for` quando o app foi
	 * explicitamente configurado para confiar no proxy à frente.
	 *
	 * A versão anterior lia `x-forwarded-for` na mão, sem `trust proxy`
	 * configurado: o cliente escolhia o próprio identificador. Bastava variar
	 * o header a cada requisição para o limite de 12/min no `/auth/signin`
	 * deixar de existir — e, de quebra, cada variação criava um bucket novo,
	 * dando ao atacante o controle do consumo de memória do processo.
	 *
	 * User-agent e accept-language continuam entrando: separam clientes atrás
	 * de um mesmo IP (NAT corporativo, operadora móvel). Continuam sendo
	 * controlados pelo cliente, mas agora só ajudam a SEPARAR quem divide um
	 * IP — não a escapar do próprio IP.
	 */
	private buildFingerprint(req: Request): string {
		const ip = req.ip || req.socket?.remoteAddress || 'unknown';
		const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
		const acceptLanguage = String(req.headers['accept-language'] || '').slice(
			0,
			120
		);
		return createHash('sha256')
			.update(`${ip}|${userAgent}|${acceptLanguage}`)
			.digest('hex');
	}
}
