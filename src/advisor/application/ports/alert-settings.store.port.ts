import { AlertSettings } from '../../domain/alert-settings';

export interface StoredAlertSettings {
	settings: AlertSettings;
	/** Quando o motor ligou para a organização (base do "sem contato"). */
	engineEnabledAt: Date;
	updatedByUserId?: string;
	updatedAt?: Date;
}

export interface AlertSettingsStorePort {
	find(orgId: string): Promise<StoredAlertSettings | null>;
	/** Grava o conjunto inteiro e preserva `engineEnabledAt`. */
	upsertSettings(
		orgId: string,
		settings: AlertSettings,
		userId: string
	): Promise<StoredAlertSettings>;
	/**
	 * Cria o registro (limites padrão) se não existir e devolve a data
	 * gravada. Idempotente, também na corrida: todos recebem a mesma data.
	 */
	ensureEngineEnabled(orgId: string, at: Date): Promise<Date>;
}
