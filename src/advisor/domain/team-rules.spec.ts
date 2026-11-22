import { MemberInviteStatus } from './enums';
import {
	canResendMemberInvite,
	memberInviteLink,
	memberInviteUsability,
} from './team-rules';

const NOW = new Date('2026-11-21T12:00:00Z');
const FUTURE = new Date('2026-11-25T12:00:00Z');
const PAST = new Date('2026-11-20T12:00:00Z');

describe('team-rules', () => {
	describe('memberInviteUsability', () => {
		it('OK quando pendente e dentro do prazo', () =>
			expect(
				memberInviteUsability(
					{ status: MemberInviteStatus.Pending, expiresAt: FUTURE },
					NOW
				)
			).toBe('OK'));

		it('EXPIRED quando a data passou', () =>
			expect(
				memberInviteUsability(
					{ status: MemberInviteStatus.Pending, expiresAt: PAST },
					NOW
				)
			).toBe('EXPIRED'));

		it('EXPIRED no instante exato do prazo', () =>
			expect(
				memberInviteUsability(
					{ status: MemberInviteStatus.Pending, expiresAt: NOW },
					NOW
				)
			).toBe('EXPIRED'));

		it('EXPIRED com data inválida (fail closed)', () =>
			expect(
				memberInviteUsability(
					{
						status: MemberInviteStatus.Pending,
						expiresAt: new Date('invalid'),
					},
					NOW
				)
			).toBe('EXPIRED'));

		it.each([
			MemberInviteStatus.Accepted,
			MemberInviteStatus.Declined,
			MemberInviteStatus.Cancelled,
			MemberInviteStatus.Expired,
		])('NOT_PENDING quando o status é %s', (status) =>
			expect(memberInviteUsability({ status, expiresAt: FUTURE }, NOW)).toBe(
				'NOT_PENDING'
			)
		);
	});

	describe('canResendMemberInvite', () => {
		it.each([0, 1, 2])('permite com resendCount %i', (resendCount) =>
			expect(
				canResendMemberInvite({
					status: MemberInviteStatus.Pending,
					resendCount,
				})
			).toBe(true)
		);

		it('recusa quando o limite de 3 reenvios foi atingido', () =>
			expect(
				canResendMemberInvite({
					status: MemberInviteStatus.Pending,
					resendCount: 3,
				})
			).toBe(false));

		it('recusa quando não está pendente', () =>
			expect(
				canResendMemberInvite({
					status: MemberInviteStatus.Accepted,
					resendCount: 0,
				})
			).toBe(false));
	});

	describe('memberInviteLink', () => {
		it('monta o link com o token no fragmento', () =>
			expect(memberInviteLink('https://advisor.trackerr.com.br', 'tok')).toBe(
				'https://advisor.trackerr.com.br/convite-equipe#token=tok'
			));

		it('ignora a barra final da base', () =>
			expect(memberInviteLink('https://advisor.trackerr.com.br/', 'tok')).toBe(
				'https://advisor.trackerr.com.br/convite-equipe#token=tok'
			));
	});
});
