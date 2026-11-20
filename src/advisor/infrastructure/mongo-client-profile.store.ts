import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ClientProfileStorePort } from '../application/ports/client-profile.store.port';
import { ClientProfile, ERASED_CLIENT_NAME } from '../domain/entities';
import { ProfileOrigin } from '../domain/enums';
import { toClientProfile } from './advisor.mappers';
import {
	ADVISOR_CLIENT_PROFILE_MODEL,
	AdvisorClientProfileDoc,
} from './advisor.models';

@Injectable()
export class MongoClientProfileStore implements ClientProfileStorePort {
	constructor(
		@InjectModel(ADVISOR_CLIENT_PROFILE_MODEL)
		private readonly profiles: Model<AdvisorClientProfileDoc>
	) {}

	async create(profile: Omit<ClientProfile, 'id'>): Promise<ClientProfile> {
		const created = await this.profiles.create(profile);
		return toClientProfile(created.toObject());
	}

	async findById(id: string): Promise<ClientProfile | null> {
		const doc = await this.profiles
			.findById(id)
			.lean<AdvisorClientProfileDoc>()
			.exec();
		return doc ? toClientProfile(doc) : null;
	}

	/**
	 * Um único `findOneAndUpdate` com o filtro "ADVISOR_CREATED e sem dono":
	 * só uma chamada concorrente casa; as demais recebem null.
	 */
	async claimIfUnowned(
		id: string,
		userId: string
	): Promise<ClientProfile | null> {
		const doc = await this.profiles
			.findOneAndUpdate(
				{ _id: id, origin: ProfileOrigin.AdvisorCreated, ownerUserId: null },
				{
					$set: { origin: ProfileOrigin.ClientCreated, ownerUserId: userId },
				},
				{ new: true }
			)
			.lean<AdvisorClientProfileDoc>()
			.exec();
		return doc ? toClientProfile(doc) : null;
	}

	/** Mesmo padrão de `claimIfUnowned`, para o perfil nascido de convite. */
	async setOwnerIfUnowned(
		id: string,
		userId: string
	): Promise<ClientProfile | null> {
		const doc = await this.profiles
			.findOneAndUpdate(
				{ _id: id, origin: ProfileOrigin.ClientCreated, ownerUserId: null },
				{ $set: { ownerUserId: userId } },
				{ new: true }
			)
			.lean<AdvisorClientProfileDoc>()
			.exec();
		return doc ? toClientProfile(doc) : null;
	}

	async anonymizeByOwner(userId: string): Promise<number> {
		const result = await this.profiles
			.updateMany(
				{ ownerUserId: userId },
				{ $set: { name: ERASED_CLIENT_NAME }, $unset: { ownerUserId: '' } }
			)
			.exec();
		return result.modifiedCount ?? 0;
	}
}
