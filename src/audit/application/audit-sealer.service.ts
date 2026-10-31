import {
	Inject,
	Injectable,
	Logger,
	OnApplicationBootstrap,
	OnModuleDestroy,
} from '@nestjs/common';
import { computeEventHash } from 'src/audit/domain/audit-event';
import { AUDIT_CLOCK, AUDIT_INSTANCE_ID } from './audit.tokens';
import {
	AUDIT_EVENT_STORE,
	AuditChainHead,
	AuditEventStore,
} from './ports/audit-event-store.port';

export const AUDIT_SEAL_INTERVAL_MS = 5_000;
/** Validade da concessão: cobre uma rodada longa e expira sozinha se a instância cair. */
export const AUDIT_LEASE_MS = 30_000;
const BATCH = 100;

/**
 * Selador da trilha (ADR-004, seção 9.3): numera os eventos pendentes e os
 * encadeia pelo hash, numa ordem só.
 *
 * Só uma instância sela por vez (concessão no Mongo). Se uma instância cair
 * entre gravar o selo de um evento e avançar o ponteiro da cadeia, a próxima
 * a assumir reconcilia o ponteiro com o último evento selado antes de seguir:
 * sem isso, o evento seguinte reusaria o mesmo `seq`.
 *
 * Roda num relógio próprio de 5 s, fora do request. Selador parado não
 * impede ninguém de trabalhar: os eventos esperam pendentes e a verificação
 * diz quantos.
 */
@Injectable()
export class AuditSealerService
	implements OnApplicationBootstrap, OnModuleDestroy
{
	private readonly logger = new Logger(AuditSealerService.name);
	private timer: NodeJS.Timeout | null = null;
	private running = false;

	constructor(
		@Inject(AUDIT_EVENT_STORE) private readonly store: AuditEventStore,
		@Inject(AUDIT_CLOCK) private readonly clock: () => Date,
		@Inject(AUDIT_INSTANCE_ID) private readonly owner: string
	) {}

	onApplicationBootstrap(): void {
		// Sem Mongo (teste que sobe o módulo à mão), nada a selar.
		this.timer = setInterval(() => void this.tick(), AUDIT_SEAL_INTERVAL_MS);
		this.timer.unref?.();
	}

	onModuleDestroy(): void {
		if (this.timer) clearInterval(this.timer);
	}

	private async tick(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			await this.sealPending();
		} catch (err) {
			this.logger.error(
				`Trilha de auditoria: o selador falhou: ${(err as Error)?.message ?? err}`
			);
		} finally {
			this.running = false;
		}
	}

	/** Sela tudo o que está pendente e devolve quantos eventos selou. */
	async sealPending(): Promise<number> {
		// Leitura barata antes da concessão: sem nada pendente, as instâncias não
		// disputam o documento da cadeia a cada 5 s.
		if ((await this.store.countPending()) === 0) return 0;

		const leased = await this.store.tryAcquireLease(
			this.owner,
			this.clock(),
			AUDIT_LEASE_MS
		);
		if (!leased) return 0;

		try {
			let head = await this.reconcile(leased);
			let sealed = 0;

			for (;;) {
				const pending = await this.store.findPending(BATCH);
				if (!pending.length) break;

				let progressed = false;
				for (const event of pending) {
					const seq = head.seq + 1;
					const hash = computeEventHash(event, seq, head.hash);
					const done = await this.store.seal(event.eventId, {
						seq,
						prevHash: head.hash,
						hash,
						sealedAt: this.clock(),
					});
					if (!done) continue;
					head = { seq, hash };
					await this.store.advanceHead(this.owner, head);
					sealed += 1;
					progressed = true;
				}
				// Nenhum selado numa passada cheia: não há o que fazer agora.
				if (!progressed) break;
			}
			return sealed;
		} finally {
			await this.store.releaseLease(this.owner);
		}
	}

	private async reconcile(head: AuditChainHead): Promise<AuditChainHead> {
		const last = await this.store.findLastSealed();
		if (!last || last.seq <= head.seq) return head;
		const fixed = { seq: last.seq, hash: last.hash };
		await this.store.advanceHead(this.owner, fixed);
		this.logger.warn(
			`Trilha de auditoria: ponteiro da cadeia atrasado (${head.seq}); reconciliado com o evento ${last.seq}.`
		);
		return fixed;
	}
}
