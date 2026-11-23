import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AlertSettings } from '../domain/alert-settings';
import {
	AlertSettingsStorePort,
	StoredAlertSettings,
} from '../application/ports/alert-settings.store.port';
import {
	ADVISOR_ALERT_SETTINGS_MODEL,
	AdvisorAlertSettingsDoc,
} from './advisor-attention.models';
import { toStoredAlertSettings } from './advisor.mappers';
import { retryOnDuplicateKey } from './mongo-duplicate-key';

@Injectable()
export class MongoAlertSettingsStore implements AlertSettingsStorePort {
	constructor(
		@InjectModel(ADVISOR_ALERT_SETTINGS_MODEL)
		private readonly settings: Model<AdvisorAlertSettingsDoc>
	) {}

	async find(orgId: string): Promise<StoredAlertSettings | null> {
		const doc = await this.settings
			.findOne({ orgId })
			.lean<AdvisorAlertSettingsDoc>()
			.exec();
		return doc ? toStoredAlertSettings(doc) : null;
	}

	/** `engineEnabledAt` só entra no insert: uma org que já o tem o mantém. */
	async upsertSettings(
		orgId: string,
		settings: AlertSettings,
		userId: string
	): Promise<StoredAlertSettings> {
		const now = new Date();
		const doc = await retryOnDuplicateKey(() =>
			this.settings
				.findOneAndUpdate(
					{ orgId },
					{
						$set: { settings, updatedByUserId: userId, updatedAt: now },
						$setOnInsert: { engineEnabledAt: now },
					},
					{ upsert: true, new: true, setDefaultsOnInsert: true }
				)
				.lean<AdvisorAlertSettingsDoc>()
				.exec()
		);
		return toStoredAlertSettings(doc as AdvisorAlertSettingsDoc);
	}

	/** Quem chega primeiro grava a data; os outros recebem a mesma. */
	async ensureEngineEnabled(orgId: string, at: Date): Promise<Date> {
		const doc = await retryOnDuplicateKey(() =>
			this.settings
				.findOneAndUpdate(
					{ orgId },
					{ $setOnInsert: { engineEnabledAt: at } },
					{ upsert: true, new: true, setDefaultsOnInsert: true }
				)
				.lean<AdvisorAlertSettingsDoc>()
				.exec()
		);
		return (doc as AdvisorAlertSettingsDoc).engineEnabledAt;
	}
}
