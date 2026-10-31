import { verifyChain } from './audit-chain';
import {
	GENESIS_HASH,
	SealedAuditEvent,
	computeEventHash,
	hashPayload,
} from './audit-event';
import { canonicalize } from './canonical-json';

function chainOf(count: number): SealedAuditEvent[] {
	const events: SealedAuditEvent[] = [];
	let prevHash = GENESIS_HASH;
	for (let seq = 1; seq <= count; seq++) {
		const payload = { agentId: 'ri-watch', toVersion: seq };
		const base = {
			eventId: `evt-${seq}`,
			type: 'agent.control.changed',
			version: 1,
			subject: 'ri-watch',
			actorRef: 'usr_abc',
			occurredAt: new Date(Date.UTC(2026, 9, 30, 12, seq)),
			payload,
			payloadHash: hashPayload(payload),
		};
		const hash = computeEventHash(base, seq, prevHash);
		events.push({
			...base,
			seq,
			prevHash,
			hash,
			createdAt: base.occurredAt,
			sealedAt: base.occurredAt,
		});
		prevHash = hash;
	}
	return events;
}

describe('canonicalize', () => {
	it('ordena as chaves e não deixa espaço', () => {
		expect(canonicalize({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe(
			'{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}'
		);
	});

	it('mesma coisa em outra ordem gera a mesma string', () => {
		expect(canonicalize({ x: 1, y: 2 })).toBe(canonicalize({ y: 2, x: 1 }));
	});

	it('data vira ISO, undefined some e null fica', () => {
		expect(
			canonicalize({
				at: new Date('2026-10-30T12:00:00Z'),
				skip: undefined,
				none: null,
			})
		).toBe('{"at":"2026-10-30T12:00:00.000Z","none":null}');
	});

	it.each([NaN, Infinity, () => 1, Symbol('x'), BigInt(1)])(
		'recusa o que não tem forma estável (%p)',
		(value) => {
			expect(() => canonicalize({ value })).toThrow();
		}
	);

	it('recusa data inválida', () => {
		expect(() => canonicalize(new Date('nada'))).toThrow('data inválida');
	});
});

describe('verifyChain', () => {
	it('cadeia íntegra passa e conta os eventos', () => {
		expect(verifyChain(chainOf(5), 1, GENESIS_HASH)).toEqual({
			ok: true,
			checked: 5,
			firstBroken: null,
		});
	});

	it('cadeia vazia é íntegra', () => {
		expect(verifyChain([], 1, GENESIS_HASH).ok).toBe(true);
	});

	it('conteúdo alterado é pego pelo hash do conteúdo', () => {
		const events = chainOf(4);
		events[2].payload = { agentId: 'ri-watch', toVersion: 999 };
		expect(verifyChain(events, 1, GENESIS_HASH)).toMatchObject({
			ok: false,
			firstBroken: { seq: 3, eventId: 'evt-3', reason: 'payload_hash' },
		});
	});

	it('campo do envelope alterado é pego pelo hash do elo', () => {
		const events = chainOf(4);
		events[1].actorRef = 'usr_outro';
		expect(verifyChain(events, 1, GENESIS_HASH)).toMatchObject({
			ok: false,
			firstBroken: { seq: 2, reason: 'hash' },
		});
	});

	it('evento apagado do meio deixa buraco na sequência', () => {
		const events = chainOf(5);
		events.splice(2, 1);
		expect(verifyChain(events, 1, GENESIS_HASH)).toMatchObject({
			ok: false,
			firstBroken: { seq: 4, reason: 'seq_gap' },
		});
	});

	it('dois eventos trocados de lugar quebram a cadeia', () => {
		const events = chainOf(4);
		[events[1], events[2]] = [events[2], events[1]];
		expect(verifyChain(events, 1, GENESIS_HASH).ok).toBe(false);
	});

	it('elo anterior adulterado, mesmo com o hash refeito, não passa', () => {
		const events = chainOf(3);
		// Quem altera o evento 2 e refaz o hash dele ainda não consegue
		// consertar o elo do evento 3, que guarda o hash antigo.
		events[1].payload = { agentId: 'ri-watch', toVersion: 77 };
		events[1].payloadHash = hashPayload(events[1].payload);
		events[1].hash = computeEventHash(events[1], 2, events[1].prevHash);
		expect(verifyChain(events, 1, GENESIS_HASH)).toMatchObject({
			ok: false,
			firstBroken: { seq: 3, reason: 'prev_hash' },
		});
	});

	it('confere um trecho a partir do hash do evento anterior', () => {
		const events = chainOf(6);
		expect(verifyChain(events.slice(3), 4, events[2].hash).ok).toBe(true);
		expect(verifyChain(events.slice(3), 4, GENESIS_HASH)).toMatchObject({
			ok: false,
			firstBroken: { seq: 4, reason: 'prev_hash' },
		});
	});
});
