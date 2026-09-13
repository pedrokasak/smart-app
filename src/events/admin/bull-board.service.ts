import { Inject, Injectable, Logger } from '@nestjs/common';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { RequestHandler } from 'express';
import {
	EVENT_QUEUE_CONFIG,
	EventQueueConfig,
} from 'src/events/infrastructure/bullmq/queue.config';
import { BullmqEventQueueAdapter } from 'src/events/infrastructure/bullmq/bullmq-event-queue.adapter';

/** Prefixo da rota do painel. Usado tambem pelo controller. */
export const BULL_BOARD_BASE_PATH = '/admin/queues';

/**
 * Monta a bull-board sobre as filas de evento (TRA-136, fase 2).
 *
 * O router e construido preguicosamente e uma unica vez. Quando a fila esta
 * desligada nao ha router — o controller responde 503 em vez de tentar
 * inspecionar filas que nunca foram abertas.
 */
@Injectable()
export class BullBoardService {
	private readonly logger = new Logger(BullBoardService.name);
	private router?: RequestHandler;

	constructor(
		@Inject(EVENT_QUEUE_CONFIG) private readonly config: EventQueueConfig,
		private readonly queueAdapter: BullmqEventQueueAdapter
	) {}

	get enabled(): boolean {
		return this.config.enabled;
	}

	handler(): RequestHandler | undefined {
		if (!this.config.enabled) return undefined;
		if (this.router) return this.router;

		const serverAdapter = new ExpressAdapter();
		serverAdapter.setBasePath(BULL_BOARD_BASE_PATH);

		createBullBoard({
			queues: this.queueAdapter
				.observableQueues()
				.map((queue) => new BullMQAdapter(queue, { readOnlyMode: true })),
			serverAdapter,
		});

		this.logger.log(`bull-board disponivel em ${BULL_BOARD_BASE_PATH}`);
		this.router = serverAdapter.getRouter() as RequestHandler;
		return this.router;
	}
}
