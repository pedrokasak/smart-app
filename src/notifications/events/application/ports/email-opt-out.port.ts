import { Types } from 'mongoose';

/**
 * Chave geral "Notificações por e-mail" das configurações (TRA-244).
 *
 * O toggle grava `Profile.preferences.notifications`, mas o disparo só olhava
 * `User.notificationPreferences.email[tipo]` — desligar não mudava nada. Esta
 * porta dá ao disparo a leitura da chave geral sem acoplar o módulo de
 * notificações ao schema de perfil.
 */
export interface EmailOptOutReader {
	hasOptedOut(userId: Types.ObjectId): Promise<boolean>;
}

export const EMAIL_OPT_OUT_READER = Symbol('EMAIL_OPT_OUT_READER');
