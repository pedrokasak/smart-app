import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class StripeWebhookMiddleware implements NestMiddleware {
	use(req: Request, res: Response, next: NextFunction) {
		if (req.path === '/webhooks/stripe') {
			// Para webhooks do Stripe, precisamos do body raw
			let data = '';
			req.setEncoding('utf8');

			req.on('data', (chunk) => {
				data += chunk;
			});

			req.on('end', () => {
				req.body = data;
				next();
			});
		} else {
			next();
		}
	}
}
