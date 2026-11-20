import {
	CallHandler,
	ExecutionContext,
	Injectable,
	NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';

/**
 * For routes whose URL carries a secret (the invite token): the response is
 * never cached and never leaks the URL as a referrer. Set before pipes and
 * handler run, so a 400 from validation and a 404 from the service carry the
 * headers too.
 */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const res = context.switchToHttp().getResponse<Response>();
		res.setHeader('Cache-Control', 'no-store');
		res.setHeader('Referrer-Policy', 'no-referrer');
		return next.handle();
	}
}
