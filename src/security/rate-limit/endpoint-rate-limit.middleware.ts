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
		'POST:/broker-sync/upload-note': { limit: 20, windowMs: 10 * 60_000 },
	};
	private cleanupTimer: NodeJS.Timeout | null = null;

	use(req: Request, res: Response, next: NextFunction): void {
		if (!this.cleanupTimer) {
			this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
			this.cleanupTimer.unref();
		}

		const routeKey = `${req.method.toUpperCase()}:${req.path}`;
		const rule = this.rules[routeKey] || this.defaultRule;
		const fingerprint = this.buildFingerprint(req);
		const now = Date.now();
		const key = `${routeKey}:${fingerprint}`;
		const existing = this.buckets.get(key);

		if (!existing || existing.resetAt <= now) {
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

	private buildFingerprint(req: Request): string {
		const forwarded = String(req.headers['x-forwarded-for'] || '')
			.split(',')[0]
			.trim();
		const ip = forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
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
