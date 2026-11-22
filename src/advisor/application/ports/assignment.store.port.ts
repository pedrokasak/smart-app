import { ClientAssignment } from '../../domain/team.entities';

export interface ListAssignedClientsQuery {
	/** Cursor opaco devolvido por uma página anterior. */
	cursor?: string;
	limit: number;
}

export interface AssignedClientsPage {
	ids: string[];
	nextCursor: string | null;
}

export interface AssignResult {
	assignment: ClientAssignment;
	created: boolean;
}

export interface AssignmentStorePort {
	/**
	 * Idempotente pelo trio (orgId, clientProfileId, userId): repetir devolve a
	 * atribuição existente, sem alterar `assignedBy` nem `createdAt`.
	 * `created` é true só para a chamada que gravou a linha; em chamadas
	 * concorrentes do mesmo trio, exatamente uma recebe true.
	 */
	assign(
		orgId: string,
		clientProfileId: string,
		userId: string,
		assignedBy: string
	): Promise<AssignResult>;
	/** Remove a atribuição; false se não existia. */
	unassign(
		orgId: string,
		clientProfileId: string,
		userId: string
	): Promise<boolean>;
	isAssigned(
		orgId: string,
		clientProfileId: string,
		userId: string
	): Promise<boolean>;
	/** Ordem estável: `createdAt` crescente, desempate por id. */
	listByClient(
		orgId: string,
		clientProfileId: string
	): Promise<ClientAssignment[]>;
	/**
	 * Ids dos perfis atribuídos àquele assessor naquela organização,
	 * `createdAt` crescente com desempate por id. O cursor codifica
	 * (createdAt, id) da atribuição em base64url, então apagar atribuições
	 * entre páginas não repete nem pula itens; `nextCursor` é null na última.
	 */
	listClientIdsByUser(
		orgId: string,
		userId: string,
		query: ListAssignedClientsQuery
	): Promise<AssignedClientsPage>;
	/** Apaga as atribuições do assessor naquela organização. */
	deleteByUser(orgId: string, userId: string): Promise<number>;
	/** LGPD: apaga as atribuições do usuário em todas as organizações. */
	deleteAllForUser(userId: string): Promise<number>;
	/** Apaga as atribuições daquele perfil naquela organização. */
	deleteByClient(orgId: string, clientProfileId: string): Promise<number>;
}
