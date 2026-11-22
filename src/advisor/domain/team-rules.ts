import { MemberInviteStatus } from './enums';
import { MAX_INVITE_RESENDS } from './invite-rules';
import { MemberInvite } from './team.entities';

export type MemberInviteUsability = 'OK' | 'EXPIRED' | 'NOT_PENDING';

export function memberInviteUsability(
	invite: Pick<MemberInvite, 'status' | 'expiresAt'>,
	now: Date
): MemberInviteUsability {
	if (invite.status !== MemberInviteStatus.Pending) return 'NOT_PENDING';
	// Fail closed: uma data inválida (NaN) nunca vale como "ainda válido".
	return now.getTime() < invite.expiresAt.getTime() ? 'OK' : 'EXPIRED';
}

export function canResendMemberInvite(
	invite: Pick<MemberInvite, 'status' | 'resendCount'>
): boolean {
	return (
		invite.status === MemberInviteStatus.Pending &&
		invite.resendCount < MAX_INVITE_RESENDS
	);
}

/** O token vai no fragmento (#), que o navegador não envia ao servidor. */
export function memberInviteLink(baseUrl: string, token: string): string {
	return `${baseUrl.replace(/\/+$/, '')}/convite-equipe#token=${token}`;
}
