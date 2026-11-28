import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
	AGENT_GATE,
	AgentGate,
} from 'src/agent-control/application/agent-gate.port';
import { reportAgentRun } from 'src/agent-control/application/agent-run-context';
import { AgentRun } from 'src/agent-control/application/agent-run.decorator';
import { RelationshipStatus } from '../../domain/enums';
import {
	ADVISOR_CLIENT_SNAPSHOT_STORE,
	ADVISOR_ORG_STORE,
	ADVISOR_RELATIONSHIP_STORE,
} from '../advisor.tokens';
import type { ClientSnapshotStorePort } from '../ports/client-snapshot.store.port';
import type { OrganizationStorePort } from '../ports/organization.store.port';
import type { RelationshipStorePort } from '../ports/relationship.store.port';
import { ClientSnapshotService } from './client-snapshot.service';

/** Clientes recomputados ao mesmo tempo. */
export const ATTENTION_JOB_CONCURRENCY = 4;
const ORG_PAGE = 500;
const RELATIONSHIP_PAGE = 200;

export interface AttentionRunCounts {
	clients: number;
	failed: number;
	opened: number;
	updated: number;
	resolved: number;
}

/**
 * Recomputação diária da atenção (spec P3b §8): todo dia útil às 20h00
 * (America/Sao_Paulo), depois do fechamento. Percorre as organizações e os
 * clientes de relação ACTIVE e, depois, os que ainda têm snapshot sem relação
 * ACTIVE (R28: o gatilho da revogação pode ter se perdido; a recomputação
 * aposenta o cliente e apaga o que veio do B2C). A falha de um cliente (ou
 * de uma organização) não para os outros. Job de sistema: registrado pelo `@AgentRun`, sem
 * auditoria de acesso. Sem trava: com mais de uma réplica, precisa de uma
 * trava no Redis.
 */
@Injectable()
export class AttentionScheduler {
	private readonly logger = new Logger(AttentionScheduler.name);

	constructor(
		@Inject(ADVISOR_ORG_STORE) private readonly orgs: OrganizationStorePort,
		@Inject(ADVISOR_RELATIONSHIP_STORE)
		private readonly relationships: RelationshipStorePort,
		private readonly snapshots: ClientSnapshotService,
		@Inject(ADVISOR_CLIENT_SNAPSHOT_STORE)
		private readonly readModel: ClientSnapshotStorePort,
		@Optional() @Inject(AGENT_GATE) private readonly agentGate?: AgentGate
	) {}

	@Cron('0 20 * * 1-5', { timeZone: 'America/Sao_Paulo' })
	@AgentRun('advisor-attention')
	async run(): Promise<AttentionRunCounts> {
		const now = new Date();
		const counts: AttentionRunCounts = {
			clients: 0,
			failed: 0,
			opened: 0,
			updated: 0,
			resolved: 0,
		};
		let cursor: string | undefined;
		do {
			const page = await this.orgs.listIds(cursor, ORG_PAGE);
			for (const orgId of page.ids) {
				try {
					await this.runOrg(orgId, now, counts);
				} catch (error) {
					counts.failed += 1;
					this.logger.error(
						`Attention job failed for org ${orgId}: ${nameOf(error)}`
					);
				}
			}
			cursor = page.nextCursor ?? undefined;
		} while (cursor);

		reportAgentRun({ items: counts.clients, errors: counts.failed });
		if (counts.failed > 0) {
			this.logger.warn(`Attention job: ${counts.failed} isolated failure(s).`);
		}
		return counts;
	}

	private async runOrg(
		orgId: string,
		now: Date,
		counts: AttentionRunCounts
	): Promise<void> {
		const visited = new Set<string>();
		let cursor: string | undefined;
		do {
			const page = await this.relationships.listByOrg(orgId, {
				statuses: [RelationshipStatus.Active],
				cursor,
				limit: RELATIONSHIP_PAGE,
			});
			const clientIds = page.items.map((r) => r.clientProfileId);
			for (const id of clientIds) visited.add(id);
			await this.recomputeAll(orgId, clientIds, now, counts);
			cursor = page.nextCursor ?? undefined;
		} while (cursor);

		// R28: read model de quem não tem mais relação ACTIVE.
		const leftovers = (await this.readModel.listClientIds(orgId)).filter(
			(id) => !visited.has(id)
		);
		for (let i = 0; i < leftovers.length; i += RELATIONSHIP_PAGE) {
			await this.recomputeAll(
				orgId,
				leftovers.slice(i, i + RELATIONSHIP_PAGE),
				now,
				counts
			);
		}
	}

	private async recomputeAll(
		orgId: string,
		clientIds: string[],
		now: Date,
		counts: AttentionRunCounts
	): Promise<void> {
		const results = await settleWithConcurrency(
			clientIds,
			ATTENTION_JOB_CONCURRENCY,
			(clientProfileId) => this.snapshots.recompute(orgId, clientProfileId, now)
		);
		for (const result of results) {
			if (result.status === 'fulfilled') {
				counts.clients += 1;
				counts.opened += result.value.opened;
				counts.updated += result.value.updated;
				counts.resolved += result.value.resolved;
			} else {
				counts.failed += 1;
				this.logger.error(
					`Attention recompute failed in org ${orgId}: ${nameOf(result.reason)}`
				);
			}
		}
	}
}

/**
 * `Promise.allSettled` com no máximo `limit` tarefas ao mesmo tempo; os
 * resultados saem na ordem de `items`.
 */
export async function settleWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
	const results: PromiseSettledResult<R>[] = new Array(items.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const index = next++;
			const [settled] = await Promise.allSettled([
				Promise.resolve().then(() => task(items[index])),
			]);
			results[index] = settled;
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker)
	);
	return results;
}

const nameOf = (error: unknown): string =>
	error instanceof Error ? error.constructor.name : 'unknown';
