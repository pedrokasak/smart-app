export abstract class ProfileRepository {
	abstract create(
		address: string,
		cpf: string,
		permissions: string,
		password: string,
		user: string
	): Promise<void>;
}
