import { Injectable, Logger } from '@nestjs/common';
import { ClientSnapshotService } from '../application/attention/client-snapshot.service';
import type { ClientSnapshotTriggerPort } from '../application/ports/client-snapshot-trigger.port';

/** Recomputações simultâneas, no máximo. */
export const SNAPSHOT_TRIGGER_CONCURRENCY = 4;

interface Pending {
	key: string;
	orgId: string;
	clientProfileId: string;
}

/**
 * Gatilho em processo: enfileira, junta pedidos iguais ainda não iniciados e
 * roda até 4 recomputações ao mesmo tempo, nunca duas do mesmo cliente. Um
 * pedido que chega enquanto o cliente recomputa espera e roda depois, para ver
 * a gravação nova. Nada sobe para quem pediu; uma falha registra só a classe
 * do erro. Fila em memória: um pedido perdido num restart é corrigido pelo job
 * diário. Trocar por uma fila não muda quem chama.
 */
@Injectable()
export class InProcessSnapshotTrigger implements ClientSnapshotTriggerPort {
	private readonly logger = new Logger(InProcessSnapshotTrigger.name);
	private readonly queue: Pending[] = [];
	private readonly queued = new Set<string>();
	private readonly running = new Set<string>();
	private idleWaiters: Array<() => void> = [];

	constructor(private readonly snapshots: ClientSnapshotService) {}

	request(orgId: string, clientProfileId: string): void {
		try {
			const key = `${orgId}\u0000${clientProfileId}`;
			if (this.queued.has(key)) return;
			this.queued.add(key);
			this.queue.push({ key, orgId, clientProfileId });
			// Fora da pilha de quem pediu: a resposta HTTP não espera o cálculo.
			setImmediate(() => this.drain());
		} catch (error) {
			this.logFailure(error);
		}
	}

	/** Resolve quando a fila esvazia e nada está rodando (testes, shutdown). */
	whenIdle(): Promise<void> {
		if (this.isIdle()) return Promise.resolve();
		return new Promise((resolve) => this.idleWaiters.push(resolve));
	}

	private drain(): void {
		while (this.running.size < SNAPSHOT_TRIGGER_CONCURRENCY) {
			const index = this.queue.findIndex((p) => !this.running.has(p.key));
			if (index < 0) break;
			const [next] = this.queue.splice(index, 1);
			this.queued.delete(next.key);
			this.running.add(next.key);
			void this.run(next).finally(() => {
				this.running.delete(next.key);
				this.drain();
			});
		}
		if (this.isIdle()) this.notifyIdle();
	}

	private async run(p: Pending): Promise<void> {
		try {
			await this.snapshots.recompute(p.orgId, p.clientProfileId, new Date());
		} catch (error) {
			this.logFailure(error);
		}
	}

	private isIdle(): boolean {
		return this.queue.length === 0 && this.running.size === 0;
	}

	private notifyIdle(): void {
		const waiters = this.idleWaiters;
		this.idleWaiters = [];
		for (const resolve of waiters) resolve();
	}

	private logFailure(error: unknown): void {
		this.logger.error(
			`Snapshot recompute failed: ${
				error instanceof Error ? error.constructor.name : 'unknown'
			}`
		);
	}
}
