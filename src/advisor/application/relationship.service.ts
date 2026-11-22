import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AdvisoryRelationship } from '../domain/entities';
import { RelationshipStatus } from '../domain/enums';
import { ADVISOR_RELATIONSHIP_STORE } from './advisor.tokens';
import type { RelationshipStorePort } from './ports/relationship.store.port';

@Injectable()
export class RelationshipService {
	constructor(
		@Inject(ADVISOR_RELATIONSHIP_STORE)
		private readonly relationships: RelationshipStorePort
	) {}

	/**
	 * Cria a relação ACTIVE entre a org e o perfil. Idempotente: se já existe
	 * uma ACTIVE, devolve ela. Se só existe REVOKED, cria uma nova linha.
	 */
	async create(
		orgId: string,
		clientProfileId: string
	): Promise<AdvisoryRelationship> {
		const existing = await this.relationships.findByOrgAndClient(
			orgId,
			clientProfileId
		);
		if (existing?.status === RelationshipStatus.Active) {
			return existing;
		}
		return this.relationships.create({
			orgId,
			clientProfileId,
			status: RelationshipStatus.Active,
		});
	}

	/**
	 * Cria sempre uma nova relação PENDING (aguardando o aceite do investidor).
	 * Nunca devolve uma relação existente.
	 */
	async createPending(
		orgId: string,
		clientProfileId: string
	): Promise<AdvisoryRelationship> {
		return this.relationships.create({
			orgId,
			clientProfileId,
			status: RelationshipStatus.Pending,
		});
	}

	/** Revoga só se estiver PENDING; ACTIVE, REVOKED ou inexistente: no-op. */
	async revokePending(id: string): Promise<void> {
		const relationship = await this.relationships.findById(id);
		if (relationship?.status !== RelationshipStatus.Pending) {
			return;
		}
		await this.relationships.save({
			...relationship,
			status: RelationshipStatus.Revoked,
		});
	}

	/**
	 * Apaga a relação de verdade. Só para desfazer uma criação: o chamador
	 * passa apenas o id que ele mesmo acabou de criar.
	 */
	async deleteCreated(id: string): Promise<void> {
		await this.relationships.deleteById(id);
	}

	/** Devolve true se esta chamada mudou o status para REVOKED. */
	async revoke(id: string): Promise<boolean> {
		const relationship = await this.relationships.findById(id);
		if (!relationship) {
			throw new NotFoundException('Advisory relationship not found');
		}
		if (relationship.status === RelationshipStatus.Revoked) {
			return false;
		}
		await this.relationships.save({
			...relationship,
			status: RelationshipStatus.Revoked,
		});
		return true;
	}
}
