import { ForbiddenException } from '@nestjs/common';
import { Role } from 'src/auth/enums/role.enum';

/** Dono da requisição, sempre do JWT — nunca de corpo, query ou rota. */
export function requesterIdOf(req: any): string {
	const requesterId = String(req?.user?.userId ?? req?.user?.sub ?? '');
	if (!requesterId) throw new ForbiddenException('Usuário não autenticado.');
	return requesterId;
}

export function isAdminRequest(req: any): boolean {
	return req?.user?.role === Role.Admin;
}

export function assertSelfOrAdmin(req: any, targetUserId: string): void {
	const requesterId = requesterIdOf(req);
	if (isAdminRequest(req)) return;
	if (requesterId !== String(targetUserId)) {
		throw new ForbiddenException('Acesso negado a dados de outro usuário.');
	}
}
