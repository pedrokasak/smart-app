import { NotificationType } from 'src/notifications/events/domain/notification.types';
import {
	MAX_PUSH_PAYLOAD_PLAINTEXT_BYTES,
	MAX_PUSH_PAYLOAD_BYTES,
} from '../domain/push.types';
import { buildPushDigest, digestTag } from './push-digest.builder';

const NOW = new Date('2026-03-10T12:00:00.000Z');

const dividend = {
	type: NotificationType.DividendReceived as const,
	symbol: 'ITSA4',
	amount: 123.45,
};

const scoreDrop = {
	type: NotificationType.PortfolioScoreDropped as const,
	score: 60,
	previousScore: 75,
	dropPoints: 15,
	maxScore: 100,
};

describe('buildPushDigest', () => {
	it('nao produz payload quando nao ha nada a resumir (push vazio e spam)', () => {
		expect(buildPushDigest([], NOW)).toBeNull();
	});

	it('com UMA notificacao, leva o titulo dela e o deep link do evento', () => {
		const digest = buildPushDigest([dividend], NOW);

		expect(digest).not.toBeNull();
		expect(digest!.count).toBe(1);
		expect(digest!.title).toContain('ITSA4');
		expect(digest!.url).toBe('/dashboard/proventos');
	});

	it('com VARIAS, agrega em contagem e manda para o painel', () => {
		const digest = buildPushDigest([dividend, scoreDrop, dividend], NOW);

		expect(digest!.count).toBe(3);
		expect(digest!.body).toBe('3 novidades na sua carteira');
		expect(digest!.url).toBe('/dashboard');
	});

	it('usa a mesma tag do dia para colapsar avisos no aparelho', () => {
		const a = buildPushDigest([dividend], NOW)!;
		const b = buildPushDigest([scoreDrop], NOW)!;

		expect(a.tag).toBe(b.tag);
		expect(a.tag).toBe(digestTag(NOW));
		expect(
			buildPushDigest([dividend], new Date('2026-03-11T12:00:00Z'))!.tag
		).not.toBe(a.tag);
	});

	it('cabe com folga no teto dos push services mesmo com texto livre', () => {
		const enorme = {
			type: NotificationType.AiInsightHigh as const,
			title: 'T'.repeat(4000),
			summary: 'S'.repeat(8000),
		};

		const digest = buildPushDigest([enorme], NOW)!;
		const bytes = Buffer.byteLength(JSON.stringify(digest), 'utf8');

		expect(bytes).toBeLessThanOrEqual(MAX_PUSH_PAYLOAD_PLAINTEXT_BYTES);
		expect(bytes).toBeLessThan(MAX_PUSH_PAYLOAD_BYTES);
	});

	it('o resumo tipico do dia fica na casa das centenas de bytes', () => {
		const digest = buildPushDigest([dividend, scoreDrop, dividend], NOW)!;
		expect(Buffer.byteLength(JSON.stringify(digest), 'utf8')).toBeLessThan(200);
	});
});
