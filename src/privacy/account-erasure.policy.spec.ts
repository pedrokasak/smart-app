import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import mongoose from 'mongoose';
import {
	ERASABLE_COLLECTIONS,
	PORTFOLIO_OWNED_COLLECTION,
	RETAINED_COLLECTIONS,
} from './account-erasure.policy';

/**
 * Contrato da exclusão de conta (TRA-127). Model novo com referência ao
 * `User` que ninguém classificou vira dado órfão depois da exclusão: este
 * teste falha até ele entrar em ERASABLE_COLLECTIONS ou RETAINED_COLLECTIONS.
 */
function schemaFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) return schemaFiles(full);
		return /\.(model|schema)\.ts$/.test(entry) ? [full] : [];
	});
}

function referencesUser(schema: mongoose.Schema): boolean {
	return Object.values(schema.paths).some(
		(path: any) => path.options?.ref === 'User'
	);
}

describe('Política de exclusão de conta (TRA-127)', () => {
	const classified = new Set([
		...ERASABLE_COLLECTIONS.map((c) => c.model),
		...RETAINED_COLLECTIONS.map((c) => c.model),
		'User',
	]);

	it('nenhuma coleção está em mais de uma classe', () => {
		const names = [
			...ERASABLE_COLLECTIONS.map((c) => c.model),
			...RETAINED_COLLECTIONS.map((c) => c.model),
			PORTFOLIO_OWNED_COLLECTION.model,
		];
		expect(new Set(names).size).toBe(names.length);
	});

	it('todo model estático que referencia User está classificado', () => {
		for (const file of schemaFiles(join(__dirname, '..'))) {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			require(file);
		}

		const withOwner = Object.entries(mongoose.models)
			.filter(([, model]) => referencesUser(model.schema))
			.map(([name]) => name);
		const unclassified = withOwner.filter((name) => !classified.has(name));

		expect(withOwner.length).toBeGreaterThan(4);
		expect(unclassified).toEqual([]);
	});

	it('os models da política que têm schema estático existem', () => {
		const known = Object.keys(mongoose.models);
		for (const name of ['Trade', 'Asset', 'RoleChangeAudit']) {
			expect(known).toContain(name);
		}
	});
});
