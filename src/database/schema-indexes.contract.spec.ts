import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { Schema } from 'mongoose';

/**
 * Índice declarado duas vezes (ex.: `unique: true` no campo + `schema.index`
 * igual) gera dois índices com o mesmo nome e opções diferentes: o Mongo
 * recusa e o `createIndexes` para, deixando os índices seguintes do model
 * sem criar. Aconteceu em produção com User, Profile e
 * PortfolioTargetAllocation.
 */
function schemaFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) return schemaFiles(full);
		const isSchemaFile =
			/(\.model|\.schema)\.ts$/.test(entry) && !entry.endsWith('.spec.ts');
		return isSchemaFile ? [full] : [];
	});
}

function collectSchemas(): Array<{ label: string; schema: Schema }> {
	const srcRoot = join(__dirname, '..');
	const found: Array<{ label: string; schema: Schema }> = [];
	for (const file of schemaFiles(srcRoot)) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const exported = require(file);
		for (const [name, value] of Object.entries(exported)) {
			const schema =
				value instanceof Schema
					? value
					: (value as any)?.schema instanceof Schema
						? (value as any).schema
						: null;
			if (schema)
				found.push({ label: `${relative(srcRoot, file)} → ${name}`, schema });
		}
	}
	return found;
}

describe('Contrato de índices dos schemas', () => {
	const schemas = collectSchemas();

	it('encontra os schemas do projeto', () => {
		expect(schemas.length).toBeGreaterThan(15);
	});

	it('nenhum schema declara o mesmo índice duas vezes', () => {
		const duplicates: string[] = [];
		for (const { label, schema } of schemas) {
			const seen = new Set<string>();
			for (const [fields] of schema.indexes()) {
				const key = JSON.stringify(fields);
				if (seen.has(key)) duplicates.push(`${label}: ${key}`);
				seen.add(key);
			}
		}
		expect([...new Set(duplicates)]).toEqual([]);
	});
});
