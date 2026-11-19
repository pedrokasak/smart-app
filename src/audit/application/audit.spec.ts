import { AuditSealerService, AUDIT_LEASE_MS } from './audit-sealer.service';
import { AuditTrailService } from './audit-trail.service';
import { AuditVerifyService } from './audit-verify.service';
import { InMemoryAuditEventStore } from './in-memory-audit-event.store.fixture';
import { AuditEventInput } from 'src/audit/domain/audit-event';

describe('trilha de auditoria (ADR-004, 9.3)', () => {
	let now: Date;
	let store: InMemoryAuditEventStore;
	let trail: AuditTrailService;
	let sealer: AuditSealerService;
	let verifier: AuditVerifyService;
	let counter: number;

	const input = (over: Partial<AuditEventInput> = {}): AuditEventInput => {
		counter += 1;
		return {
			eventId: `evt-${counter}`,
			type: 'agent.control.changed',
			version: 1,
			subject: 'ri-watch',
			actorRef: 'usr_abc',
			occurredAt: new Date(now.getTime() + counter),
			payload: { agentId: 'ri-watch', toVersion: counter },
			...over,
		};
	};

	const sealerFor = (owner: string) =>
		new AuditSealerService(store, () => now, owner);

	beforeEach(() => {
		now = new Date('2026-10-30T12:00:00Z');
		counter = 0;
		store = new InMemoryAuditEventStore();
		trail = new AuditTrailService(store, () => now);
		sealer = sealerFor('seal_a');
		verifier = new AuditVerifyService(store);
	});

	describe('registrar', () => {
		it('grava pendente, com o hash do conteúdo e sem número ainda', async () => {
			await trail.record(input());
			expect(store.events[0]).toMatchObject({
				seq: null,
				hash: null,
				prevHash: null,
				sealedAt: null,
				payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
			});
		});

		it.each(['eventId', 'type', 'subject', 'actorRef'] as const)(
			'recusa evento sem %s',
			async (field) => {
				await expect(trail.record(input({ [field]: '' }))).rejects.toThrow(
					'sem'
				);
			}
		);

		it('recusa conteúdo sem forma canônica na hora de gravar, não ao selar', async () => {
			await expect(
				trail.record(input({ payload: { valor: NaN } }))
			).rejects.toThrow('não aceita');
			expect(store.events).toHaveLength(0);
		});

		it('grava o conteúdo na forma que volta do banco, sem undefined nem Date', async () => {
			await trail.record(
				input({
					payload: {
						a: undefined,
						quando: new Date('2026-10-30T12:00:00Z'),
						b: null,
					},
				})
			);
			expect(store.events[0].payload).toEqual({
				quando: '2026-10-30T12:00:00.000Z',
				b: null,
			});
		});

		it('o hash do conteúdo sobrevive ao round-trip do banco', async () => {
			await trail.record(
				input({ payload: { a: undefined, quando: new Date(0) } })
			);
			await sealer.sealPending();
			// O Mongo devolveria `null` onde havia `undefined`; aqui já está gravado assim.
			store.events[0].payload = JSON.parse(
				JSON.stringify(store.events[0].payload)
			);
			expect((await verifier.verify()).ok).toBe(true);
		});

		it('eventId repetido é recusado', async () => {
			await trail.record(input({ eventId: 'dup' }));
			await expect(trail.record(input({ eventId: 'dup' }))).rejects.toThrow();
		});
	});

	describe('selar', () => {
		it('numera e encadeia na ordem de chegada', async () => {
			for (let i = 0; i < 4; i++) await trail.record(input());

			await expect(sealer.sealPending()).resolves.toBe(4);

			const sealed = [...store.events].sort((a, b) => a.seq! - b.seq!);
			expect(sealed.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
			expect(sealed[1].prevHash).toBe(sealed[0].hash);
			expect(store.head).toMatchObject({ seq: 4, hash: sealed[3].hash });
		});

		it('sem nada pendente, nem disputa a concessão', async () => {
			const acquire = jest.spyOn(store, 'tryAcquireLease');
			await expect(sealer.sealPending()).resolves.toBe(0);
			expect(acquire).not.toHaveBeenCalled();
		});

		it('não sela de novo o que já está selado, e acrescenta o que chegou depois', async () => {
			await trail.record(input());
			await sealer.sealPending();
			await expect(sealer.sealPending()).resolves.toBe(0);

			await trail.record(input());
			await expect(sealer.sealPending()).resolves.toBe(1);
			expect(store.events.map((event) => event.seq)).toEqual([1, 2]);
		});

		it('duas instâncias ao mesmo tempo: uma sela, a outra não faz nada', async () => {
			await trail.record(input());
			await trail.record(input());
			const other = sealerFor('seal_b');

			// `a` pega a concessão e segura enquanto `b` tenta.
			const held = await store.tryAcquireLease('seal_a', now, AUDIT_LEASE_MS);
			expect(held).not.toBeNull();
			await expect(other.sealPending()).resolves.toBe(0);
			expect(store.events.every((event) => event.seq === null)).toBe(true);

			await store.releaseLease('seal_a');
			await expect(other.sealPending()).resolves.toBe(2);
		});

		it('concessão vencida (instância caiu) passa para outra, sem repetir número', async () => {
			await trail.record(input());
			await store.tryAcquireLease('seal_a', now, AUDIT_LEASE_MS);
			now = new Date(now.getTime() + AUDIT_LEASE_MS + 1);

			await expect(sealerFor('seal_b').sealPending()).resolves.toBe(1);
			expect(store.events[0].seq).toBe(1);
		});

		it('queda entre gravar o selo e avançar o ponteiro: a próxima reconcilia e não reusa o seq', async () => {
			await trail.record(input());
			await trail.record(input());
			store.failAdvanceOnce = true;

			await expect(sealer.sealPending()).rejects.toThrow('instância caiu');
			// O evento 1 foi selado, mas o ponteiro ficou em 0.
			expect(store.events[0].seq).toBe(1);
			expect(store.head.seq).toBe(0);

			now = new Date(now.getTime() + 1);
			await expect(sealerFor('seal_b').sealPending()).resolves.toBe(1);

			expect(store.events.map((event) => event.seq).sort()).toEqual([1, 2]);
			const report = await verifier.verify();
			expect(report).toMatchObject({ ok: true, checked: 2, pending: 0 });
		});
	});

	describe('verificar', () => {
		beforeEach(async () => {
			for (let i = 0; i < 6; i++) await trail.record(input());
			await sealer.sealPending();
		});

		it('cadeia íntegra: ok, com a cabeça e sem pendentes', async () => {
			const report = await verifier.verify();
			expect(report).toMatchObject({
				ok: true,
				checked: 6,
				pending: 0,
				firstBroken: null,
				head: { seq: 6 },
			});
		});

		it('aponta o primeiro elo quebrado quando o conteúdo é alterado', async () => {
			store.events.find((event) => event.seq === 4)!.payload = {
				agentId: 'outro',
			};
			const report = await verifier.verify();
			expect(report).toMatchObject({
				ok: false,
				checked: 3,
				firstBroken: { seq: 4, reason: 'payload_hash' },
			});
		});

		it('evento apagado aparece como buraco na sequência', async () => {
			store.events.splice(
				store.events.findIndex((event) => event.seq === 3),
				1
			);
			expect(await verifier.verify()).toMatchObject({
				ok: false,
				firstBroken: { seq: 4, reason: 'seq_gap' },
			});
		});

		it('confere só um trecho', async () => {
			expect(await verifier.verify({ fromSeq: 3, toSeq: 5 })).toMatchObject({
				ok: true,
				checked: 3,
				fromSeq: 3,
				toSeq: 5,
			});
		});

		it('um trecho fora da cadeia diz que falta o elo anterior', async () => {
			expect(await verifier.verify({ fromSeq: 50 })).toMatchObject({
				ok: false,
				firstBroken: { reason: 'seq_gap' },
			});
		});

		it('pendentes aparecem na conta e não entram na verificação', async () => {
			await trail.record(input());
			expect(await verifier.verify()).toMatchObject({
				ok: true,
				checked: 6,
				pending: 1,
			});
		});
	});
});
