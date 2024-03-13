export abstract class SignInRepository {
	abstract create(
		email: string,
		password: string,
		keepConnected: boolean
	): Promise<void>;
}
