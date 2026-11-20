import { createHash, randomBytes } from 'crypto';
import { ClientInvite } from './consent.entities';
import { InviteStatus } from './enums';

export const INVITE_TTL_DAYS = 7;
export const MAX_INVITE_RESENDS = 3;
export const CONSENT_TEXT_VERSION = '2026-11-16';

const MAX_EMAIL_LENGTH = 254;
const MAX_PORTFOLIOS_PER_CONSENT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export type InviteUsability = 'OK' | 'EXPIRED' | 'NOT_PENDING';
export type PortfolioSelectionResult =
	| 'OK'
	| 'EMPTY'
	| 'DUPLICATE'
	| 'NOT_OWNED'
	| 'TOO_MANY';

export function normalizeEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
	return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}

/** "joao@exemplo.com" -> "jo***@ex***.com". Keeps 2 chars of user and host. */
export function maskEmail(email: string): string {
	const at = email.lastIndexOf('@');
	const user = email.slice(0, at);
	const domain = email.slice(at + 1);
	const dot = domain.lastIndexOf('.');
	const host = domain.slice(0, dot);
	const tld = domain.slice(dot);
	return `${user.slice(0, 2)}***@${host.slice(0, 2)}***${tld}`;
}

export function hashInviteToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function generateInviteToken(): { token: string; tokenHash: string } {
	const token = randomBytes(32).toString('base64url');
	return { token, tokenHash: hashInviteToken(token) };
}

export function inviteExpiry(from: Date): Date {
	return new Date(from.getTime() + INVITE_TTL_DAYS * DAY_MS);
}

export function inviteUsability(
	invite: Pick<ClientInvite, 'status' | 'expiresAt'>,
	now: Date
): InviteUsability {
	if (invite.status !== InviteStatus.Pending) return 'NOT_PENDING';
	// Fail closed: an invalid date (NaN) never compares as "still valid".
	return now.getTime() < invite.expiresAt.getTime() ? 'OK' : 'EXPIRED';
}

export function emailMatches(
	invite: Pick<ClientInvite, 'email'>,
	accountEmail: string
): boolean {
	return normalizeEmail(accountEmail) === normalizeEmail(invite.email);
}

export function canResend(
	invite: Pick<ClientInvite, 'status' | 'resendCount'>
): boolean {
	return (
		invite.status === InviteStatus.Pending &&
		invite.resendCount < MAX_INVITE_RESENDS
	);
}

export function validatePortfolioSelection(
	selected: string[],
	owned: string[]
): PortfolioSelectionResult {
	if (selected.length === 0) return 'EMPTY';
	if (selected.length > MAX_PORTFOLIOS_PER_CONSENT) return 'TOO_MANY';
	if (new Set(selected).size !== selected.length) return 'DUPLICATE';
	const ownedSet = new Set(owned);
	return selected.every((id) => ownedSet.has(id)) ? 'OK' : 'NOT_OWNED';
}
