export abstract class UsersRepository {
	abstract create(
		first_name: string,
		last_name: string,
		email: string,
		password: string
	): Promise<void>;
}
