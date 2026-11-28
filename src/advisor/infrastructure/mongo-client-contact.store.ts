import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ClientContactStorePort } from '../application/ports/client-contact.store.port';
import {
	ADVISOR_CLIENT_CONTACT_MODEL,
	AdvisorClientContactDoc,
} from './advisor-attention.models';
import { isDuplicateKey } from './mongo-duplicate-key';

@Injectable()
export class MongoClientContactStore implements ClientContactStorePort {
	constructor(
		@InjectModel(ADVISOR_CLIENT_CONTACT_MODEL)
		private readonly contacts: Model<AdvisorClientContactDoc>
	) {}

	/**
	 * Um upsert que só casa se o guardado for mais antigo. Se já há um mais
	 * novo (ou igual), o filtro não casa, o insert bate no índice único e o
	 * E11000 é o "nada a fazer". Duas primeiras gravações concorrentes: a
	 * perdedora repete uma vez e vê o que a outra gravou.
	 */
	async record(
		orgId: string,
		clientProfileId: string,
		at: Date,
		userId: string
	): Promise<void> {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				await this.contacts
					.updateOne(
						{ orgId, clientProfileId, lastContactAt: { $lt: at } },
						{ $set: { lastContactAt: at, recordedByUserId: userId } },
						{ upsert: true, setDefaultsOnInsert: true }
					)
					.exec();
				return;
			} catch (error) {
				if (!isDuplicateKey(error)) throw error;
			}
		}
	}

	async find(orgId: string, clientProfileId: string): Promise<Date | null> {
		const doc = await this.contacts
			.findOne({ orgId, clientProfileId })
			.lean<AdvisorClientContactDoc>()
			.exec();
		return doc?.lastContactAt ?? null;
	}

	async deleteByClient(orgId: string, clientProfileId: string): Promise<void> {
		await this.contacts.deleteOne({ orgId, clientProfileId }).exec();
	}
}
