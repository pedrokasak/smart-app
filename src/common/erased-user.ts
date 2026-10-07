import { Types } from 'mongoose';

/**
 * Dono dos registros que sobrevivem à exclusão da conta (cobrança e
 * auditoria, TRA-127): aponta para ninguém, mas mantém o campo `required`.
 */
export const ERASED_USER_ID = new Types.ObjectId('000000000000000000000000');

export function isErasedUser(userId: unknown): boolean {
	return String(userId) === ERASED_USER_ID.toHexString();
}
