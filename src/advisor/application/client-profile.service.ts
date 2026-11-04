import {
	ConflictException,
	Inject,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { ClientProfile } from '../domain/entities';
import { ProfileOrigin } from '../domain/enums';
import { ADVISOR_CLIENT_PROFILE_STORE } from './advisor.tokens';
import type { ClientProfileStorePort } from './ports/client-profile.store.port';

@Injectable()
export class ClientProfileService {
	constructor(
		@Inject(ADVISOR_CLIENT_PROFILE_STORE)
		private readonly profiles: ClientProfileStorePort
	) {}

	createByAdvisor(
		orgId: string,
		data: { name: string }
	): Promise<ClientProfile> {
		return this.profiles.create({
			orgId,
			name: data.name,
			origin: ProfileOrigin.AdvisorCreated,
		});
	}

	/**
	 * O cliente assume um perfil criado pelo assessor. Só vale para perfil
	 * ADVISOR_CREATED sem dono; nunca sobrescreve um dono existente.
	 */
	async claim(clientProfileId: string, userId: string): Promise<ClientProfile> {
		const profile = await this.profiles.findById(clientProfileId);
		if (!profile) {
			throw new NotFoundException('Client profile not found');
		}
		if (
			profile.origin !== ProfileOrigin.AdvisorCreated ||
			profile.ownerUserId
		) {
			throw new ConflictException('Client profile already claimed');
		}
		return this.profiles.save({
			...profile,
			origin: ProfileOrigin.ClientCreated,
			ownerUserId: userId,
		});
	}
}
