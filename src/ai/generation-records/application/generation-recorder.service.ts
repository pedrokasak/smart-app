import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
	AUDIT_TRAIL,
	AuditTrail,
} from 'src/audit/application/audit-trail.port';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import {
	GenerationRecord,
	buildGenerationRecord,
	parseProvenance,
} from '../domain/generation-record';

export const GENERATION_RECORD_STORE = Symbol('GENERATION_RECORD_STORE');
export const GENERATION_RECORDER = Symbol('GENERATION_RECORDER');
// Relógio próprio: o `AuditModule` não exporta o dele.
export const GENERATION_CLOCK = Symbol('GENERATION_CLOCK');

export const AI_GENERATION_RECORDED = 'ai.generation.recorded';

export interface GenerationRecordStore {
	insert(record: GenerationRecord): Promise<void>;
	findByGenerationId(generationId: string): Promise<GenerationRecord | null>;
}

export interface GenerationRecorder {
	/**
	 * Grava o registro de cada geração e o sela na trilha, sem esperar e sem
	 * nunca lançar: a resposta de IA que o usuário aguarda não depende disto.
	 */
	record(userId: string, provenance: unknown): void;
}

@Injectable()
export class GenerationRecorderService implements GenerationRecorder {
	private readonly logger = new Logger(GenerationRecorderService.name);

	constructor(
		@Inject(GENERATION_RECORD_STORE)
		private readonly store: GenerationRecordStore,
		@Inject(AUDIT_TRAIL) private readonly trail: AuditTrail,
		@Inject(GENERATION_CLOCK) private readonly clock: () => Date
	) {}

	record(userId: string, provenance: unknown): void {
		try {
			const blocks = parseProvenance(provenance);
			if (!blocks.length || !userId) return;
			const userRef = actorRefOf(userId);
			for (const block of blocks) {
				const record = buildGenerationRecord(block, userRef, this.clock());
				void this.persist(record);
			}
		} catch (err) {
			this.logger.error(
				`Registro de geração: falha ao montar o registro: ${(err as Error)?.message ?? err}`
			);
		}
	}

	private async persist(record: GenerationRecord): Promise<void> {
		try {
			await this.store.insert(record);
		} catch (err) {
			// Reenvio do mesmo bloco (E11000) não é erro: o registro já existe.
			if ((err as { code?: number })?.code === 11000) return;
			this.logger.error(
				`Registro de geração ${record.generationId} não foi gravado: ${(err as Error)?.message ?? err}`
			);
			return;
		}
		try {
			await this.trail.record({
				eventId: randomUUID(),
				type: AI_GENERATION_RECORDED,
				version: 1,
				subject: record.generationId,
				actorRef: record.userRef,
				occurredAt: record.recordedAt,
				payload: {
					generationId: record.generationId,
					kind: record.kind,
					recordHash: record.recordHash,
					outputSha256: record.outputSha256,
				},
			});
		} catch (err) {
			this.logger.error(
				`Trilha: o evento da geração ${record.generationId} não foi gravado: ${(err as Error)?.message ?? err}`
			);
		}
	}
}
