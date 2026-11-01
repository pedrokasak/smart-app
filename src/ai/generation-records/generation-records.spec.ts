import { NotFoundException } from '@nestjs/common';
import { InMemoryAuditEventStore } from 'src/audit/application/in-memory-audit-event.store.fixture';
import { AuditTrailService } from 'src/audit/application/audit-trail.service';
import { actorRefOf } from 'src/audit/infrastructure/actor-ref';
import {
	AI_GENERATION_RECORDED,
	GenerationRecordStore,
	GenerationRecorderService,
} from './application/generation-recorder.service';
import {
	GenerationProvenance,
	GenerationRecord,
	buildGenerationRecord,
	parseProvenance,
	recordHashOf,
} from './domain/generation-record';
import { GenerationRecordsController } from './generation-records.controller';

jest.mock('src/env', () => ({ jwtSecret: 'segredo-de-teste-do-registro' }));

function block(over: Partial<GenerationProvenance> = {}): GenerationProvenance {
	return {
		version: 1,
		generation_id: 'gen_abc',
		kind: 'insight',
		prompt: { id: 'insights.narration', version: '1', sha256: 'a'.repeat(64) },
		model: { requested: 'gemini', served_provider: 'groq', model: 'llama' },
		inputs: {
			snapshot_at: '2026-11-01T09:00:00Z',
			data_window: { from: '2026-10-18', to: '2026-10-24' },
			sources: [{ source_type: 'portfolio_position', source_id: 'BTC' }],
		},
		checks: { guard: 'ok', fallback_count: 1 },
		confidence: { min: 0.6, max: 0.7, basis: 'x' },
		output_sha256: 'b'.repeat(64),
		subject_ids: ['concentration.BTC'],
		...over,
	};
}

class InMemoryRecords implements GenerationRecordStore {
	readonly rows: GenerationRecord[] = [];
	failWith: Error | null = null;

	async insert(record: GenerationRecord): Promise<void> {
		if (this.failWith) throw this.failWith;
		if (this.rows.some((r) => r.generationId === record.generationId)) {
			throw Object.assign(new Error('E11000'), { code: 11000 });
		}
		this.rows.push(record);
	}

	async findByGenerationId(id: string): Promise<GenerationRecord | null> {
		return this.rows.find((r) => r.generationId === id) ?? null;
	}
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('registro de geração de IA (ADR-004, 9.2)', () => {
	const now = new Date('2026-11-01T09:00:00Z');

	describe('parseProvenance', () => {
		it('aceita blocos completos e descarta os malformados', () => {
			const parsed = parseProvenance([
				block(),
				{ generation_id: 'sem-resto' },
				null,
				'texto',
				block({ generation_id: '' }),
			]);
			expect(parsed.map((p) => p.generation_id)).toEqual(['gen_abc']);
		});

		it('resposta sem proveniência (trackerr-ia antigo) vira lista vazia', () => {
			expect(parseProvenance(undefined)).toEqual([]);
			expect(parseProvenance({})).toEqual([]);
		});
	});

	describe('buildGenerationRecord', () => {
		it('guarda o pseudônimo e o hash do registro, recalculável', () => {
			const record = buildGenerationRecord(block(), 'usr_x', now);
			expect(record).toMatchObject({
				generationId: 'gen_abc',
				userRef: 'usr_x',
				subjectIds: ['concentration.BTC'],
				outputSha256: 'b'.repeat(64),
			});
			const { recordHash, ...rest } = record;
			expect(recordHash).toBe(recordHashOf(rest));
		});

		it('mudar qualquer campo muda o hash', () => {
			const a = buildGenerationRecord(block(), 'usr_x', now);
			const b = buildGenerationRecord(
				block({ output_sha256: 'c'.repeat(64) }),
				'usr_x',
				now
			);
			expect(a.recordHash).not.toBe(b.recordHash);
		});
	});

	describe('GenerationRecorderService', () => {
		let records: InMemoryRecords;
		let events: InMemoryAuditEventStore;
		let recorder: GenerationRecorderService;

		beforeEach(() => {
			records = new InMemoryRecords();
			events = new InMemoryAuditEventStore();
			recorder = new GenerationRecorderService(
				records,
				new AuditTrailService(events, () => now),
				() => now
			);
		});

		it('grava o registro e o evento selável, sem o id do usuário', async () => {
			recorder.record('user-1', [block()]);
			await flush();

			expect(records.rows).toHaveLength(1);
			expect(records.rows[0].userRef).toBe(actorRefOf('user-1'));
			expect(events.events).toHaveLength(1);
			expect(events.events[0]).toMatchObject({
				type: AI_GENERATION_RECORDED,
				subject: 'gen_abc',
				actorRef: actorRefOf('user-1'),
				payload: {
					generationId: 'gen_abc',
					recordHash: records.rows[0].recordHash,
				},
			});
			expect(JSON.stringify(events.events[0])).not.toContain('user-1');
		});

		it('um registro por chamada ao LLM', async () => {
			recorder.record('user-1', [
				block(),
				block({ generation_id: 'gen_def', kind: 'analysis' }),
			]);
			await flush();
			expect(records.rows.map((r) => r.generationId)).toEqual([
				'gen_abc',
				'gen_def',
			]);
		});

		it('reenvio do mesmo bloco não duplica registro nem evento', async () => {
			recorder.record('user-1', [block()]);
			await flush();
			recorder.record('user-1', [block()]);
			await flush();
			expect(records.rows).toHaveLength(1);
			expect(events.events).toHaveLength(1);
		});

		it('sem proveniência ou sem usuário, não faz nada', async () => {
			recorder.record('user-1', undefined);
			recorder.record('', [block()]);
			await flush();
			expect(records.rows).toHaveLength(0);
		});

		it('falha do banco não vira exceção e não gera evento', async () => {
			records.failWith = new Error('mongo fora');
			expect(() => recorder.record('user-1', [block()])).not.toThrow();
			await flush();
			expect(events.events).toHaveLength(0);
		});
	});

	describe('GET /ai/generations/:id', () => {
		it('devolve o registro ao dono, sem o pseudônimo', async () => {
			const records = new InMemoryRecords();
			await records.insert(
				buildGenerationRecord(block(), actorRefOf('user-1'), now)
			);
			const controller = new GenerationRecordsController(records);

			const result = await controller.get(
				{ user: { userId: 'user-1' } },
				'gen_abc'
			);

			expect(result).toMatchObject({
				generationId: 'gen_abc',
				recordHash: expect.any(String),
			});
			// Chega ao cliente como JSON: `undefined` some.
			expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('userRef');
		});

		it('registro de outra pessoa responde 404, como id inexistente', async () => {
			const records = new InMemoryRecords();
			await records.insert(
				buildGenerationRecord(block(), actorRefOf('user-1'), now)
			);
			const controller = new GenerationRecordsController(records);

			await expect(
				controller.get({ user: { userId: 'user-2' } }, 'gen_abc')
			).rejects.toBeInstanceOf(NotFoundException);
			await expect(
				controller.get({ user: { userId: 'user-1' } }, 'gen_zzz')
			).rejects.toBeInstanceOf(NotFoundException);
		});
	});
});
