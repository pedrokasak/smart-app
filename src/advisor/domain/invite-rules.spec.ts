import { InviteStatus } from './enums';
import {
	canResend,
	emailMatches,
	generateInviteToken,
	hashInviteToken,
	inviteExpiry,
	inviteUsability,
	isValidEmail,
	maskEmail,
	normalizeEmail,
	validatePortfolioSelection,
} from './invite-rules';

describe('invite-rules', () => {
	it('normaliza e-mail', () =>
		expect(normalizeEmail('  Joao@Exemplo.COM ')).toBe('joao@exemplo.com'));

	it.each(['a@b.co', 'joao.silva+x@exemplo.com.br'])('aceita %s', (e) =>
		expect(isValidEmail(e)).toBe(true)
	);

	it.each(['', 'sem-arroba', 'a@b', 'a b@c.com', `${'x'.repeat(250)}@a.com`])(
		'recusa %s',
		(e) => expect(isValidEmail(e)).toBe(false)
	);

	it('mascara e-mail', () =>
		expect(maskEmail('joao@exemplo.com')).toBe('jo***@ex***.com'));

	it('mascara e-mail com partes curtas', () =>
		expect(maskEmail('a@b.co')).toBe('a***@b***.co'));

	it('token: 43 chars base64url, hash sha-256 hex de 64, tokens distintos', () => {
		const a = generateInviteToken();
		const b = generateInviteToken();
		expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
		expect(hashInviteToken(a.token)).toBe(a.tokenHash);
		expect(a.token).not.toBe(b.token);
	});

	it('hash fixado em SHA-256 hex (vetor conhecido do FIPS 180-2)', () => {
		expect(hashInviteToken('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});

	it('expiresAt inválido conta como expirado (falha fechado)', () => {
		const now = new Date('2026-11-20T12:00:00.000Z');
		expect(
			inviteUsability(
				{ status: InviteStatus.Pending, expiresAt: new Date('nope') },
				now
			)
		).toBe('EXPIRED');
		expect(
			inviteUsability(
				{
					status: InviteStatus.Pending,
					expiresAt: new Date('2026-11-23T12:00:00.000Z'),
				},
				new Date(Number.NaN)
			)
		).toBe('EXPIRED');
	});

	it('validade de 7 dias exatos', () => {
		const from = new Date('2026-11-16T12:00:00.000Z');
		expect(inviteExpiry(from).toISOString()).toBe('2026-11-23T12:00:00.000Z');
		expect(from.toISOString()).toBe('2026-11-16T12:00:00.000Z');
	});

	it('usabilidade', () => {
		const expiresAt = new Date('2026-11-23T12:00:00.000Z');
		const before = new Date('2026-11-23T11:59:59.999Z');
		expect(
			inviteUsability({ status: InviteStatus.Pending, expiresAt }, before)
		).toBe('OK');
		expect(
			inviteUsability({ status: InviteStatus.Pending, expiresAt }, expiresAt)
		).toBe('EXPIRED');
		for (const status of [
			InviteStatus.Accepted,
			InviteStatus.Declined,
			InviteStatus.Cancelled,
			InviteStatus.Expired,
		]) {
			expect(inviteUsability({ status, expiresAt }, before)).toBe(
				'NOT_PENDING'
			);
		}
	});

	it('e-mail da conta precisa ser o do convite, sem diferenciar caixa', () => {
		const invite = { email: 'joao@exemplo.com' };
		expect(emailMatches(invite, ' Joao@Exemplo.COM ')).toBe(true);
		expect(emailMatches(invite, 'maria@exemplo.com')).toBe(false);
	});

	it('reenvio: só PENDING e resendCount < 3', () => {
		expect(canResend({ status: InviteStatus.Pending, resendCount: 0 })).toBe(
			true
		);
		expect(canResend({ status: InviteStatus.Pending, resendCount: 2 })).toBe(
			true
		);
		expect(canResend({ status: InviteStatus.Pending, resendCount: 3 })).toBe(
			false
		);
		expect(canResend({ status: InviteStatus.Accepted, resendCount: 0 })).toBe(
			false
		);
		expect(canResend({ status: InviteStatus.Cancelled, resendCount: 0 })).toBe(
			false
		);
	});

	it.each([
		[['p1'], ['p1', 'p2'], 'OK'],
		[[], ['p1'], 'EMPTY'],
		[['p1', 'p1'], ['p1'], 'DUPLICATE'],
		[['p1', 'px'], ['p1'], 'NOT_OWNED'],
	])('seleção %j de %j => %s', (sel, owned, out) =>
		expect(validatePortfolioSelection(sel, owned)).toBe(out)
	);

	it('mais de 50 carteiras => TOO_MANY; 50 => OK', () => {
		const ids = Array.from({ length: 51 }, (_, i) => `p${i}`);
		expect(validatePortfolioSelection(ids, ids)).toBe('TOO_MANY');
		expect(validatePortfolioSelection(ids.slice(0, 50), ids)).toBe('OK');
	});
});
