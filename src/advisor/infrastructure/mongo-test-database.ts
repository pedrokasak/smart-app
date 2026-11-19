import { randomUUID } from 'crypto';

export const TEST_DB_PREFIX = 'advisor_contract_';

/** Nome de banco gerado por execução; ignora o banco que a URI nomeia. */
export function buildTestDbName(): string {
	return `${TEST_DB_PREFIX}${randomUUID().replace(/-/g, '')}`;
}

/** Recusa qualquer banco que não tenha sido gerado por `buildTestDbName`. */
export function assertDisposableDb(name: string): void {
	if (!name.startsWith(TEST_DB_PREFIX)) {
		throw new Error(
			`Refusing to drop database "${name}": not a disposable ${TEST_DB_PREFIX}* database`
		);
	}
}
