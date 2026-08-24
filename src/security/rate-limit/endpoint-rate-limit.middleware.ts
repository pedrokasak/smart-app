import {
	Injectable,
	HttpException,
	HttpStatus,
	NestMiddleware,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { NextFunction, Request, Response } from 'express';

type RateLimitRule = {
	limit: number;
	windowMs: number;
};

type RateBucket = {
	count: number;
	resetAt: number;
};

@Injectable()
export class EndpointRateLimitMiddleware implements NestMiddleware {
	private readonly buckets = new Map<string, RateBucket>();
	private readonly cleanupIntervalMs = 60_000;
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
		'POST:/broker-sync/upload-note': { limit: 20, windowMs: 10 * 60_000 },
		'POST:/leads/purchase-intent': { limit: 5, windowMs: 60_000 },
		// Cada chamada destas custa uma requisição paga de LLM.
		'POST:/ai/chat': { limit: 20, windowMs: 60_000 },
		'POST:/ai/chat/intelligent': { limit: 20, windowMs: 60_000 },
		'POST:/ai/analyze': { limit: 20, windowMs: 60_000 },
	};

	/**
	 * Teto de buckets ativos. Existe pra que uma enxurrada de fingerprints
	 * distintos não vire consumo de memória sem limite entre duas passadas
	 * da limpeza — o `cleanup` só remove o que já expirou.
	 */
	private readonly maxBuckets = 50_000;
	private cleanupTimer: NodeJS.Timeout | null = null;

	use(req: Request, res: Response, next: NextFunction): void {
		if (!this.cleanupTimer) {
			this.cleanupTimer = setInterval(
				() => this.cleanup(),
				this.cleanupIntervalMs
			);
			this.cleanupTimer.unref();
		}

		const routeKey = `${req.method.toUpperCase()}:${req.path}`;
		const rule = this.rules[routeKey] || this.defaultRule;
		const fingerprint = this.buildFingerprint(req);
		const now = Date.now();
		const key = `${routeKey}:${fingerprint}`;
		const existing = this.buckets.get(key);

		if (!existing || existing.resetAt <= now) {
			if (this.buckets.size >= this.maxBuckets) {
				this.cleanup();
			}
			this.buckets.set(key, {
				count: 1,
				resetAt: now + rule.windowMs,
			});
			return next();
		}

		if (existing.count >= rule.limit) {
			const retryAfterSeconds = Math.max(
				1,
				Math.ceil((existing.resetAt - now) / 1000)
			);
			res.setHeader('Retry-After', String(retryAfterSeconds));
			throw new HttpException(
				`Rate limit excedido para este endpoint. Tente novamente em ${retryAfterSeconds}s.`,
				HttpStatus.TOO_MANY_REQUESTS
			);
		}

		existing.count += 1;
		this.buckets.set(key, existing);
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

	private cleanup(): void {
		const now = Date.now();
		for (const [key, bucket] of this.buckets.entries()) {
			if (bucket.resetAt <= now) {
				this.buckets.delete(key);
			}
		}
	}
}
