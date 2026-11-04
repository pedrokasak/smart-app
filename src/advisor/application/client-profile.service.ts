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
	 * ADVISOR_CREATED sem dono; nunca sobrescreve um dono existente. A
	 * transição é atômica no store, sem janela entre ler e gravar.
	 */
	async claim(clientProfileId: string, userId: string): Promise<ClientProfile> {
		const claimed = await this.profiles.claimIfUnowned(clientProfileId, userId);
		if (claimed) {
			return claimed;
		}
		const existing = await this.profiles.findById(clientProfileId);
		if (!existing) {
			throw new NotFoundException('Client profile not found');
		}
		throw new ConflictException('Client profile already claimed');
	}
}
