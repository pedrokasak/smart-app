import { ClientProfile } from '../../domain/entities';

export interface ClientProfileStorePort {
  /** Persiste o perfil do cliente; o store gera o id. */
  create(profile: Omit<ClientProfile, 'id'>): Promise<ClientProfile>;
  findById(id: string): Promise<ClientProfile | null>;
  save(profile: ClientProfile): Promise<ClientProfile>;
}
