export abstract class AuthenticationRepository {
	abstract create(
		email: string,
		password: string,
		keepConnected: boolean
	): Promise<void>;
}
