import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from 'src/auth/decorators/roles.decorator';
import {
	OWNERSHIP_KEY,
	OwnershipDeclaration,
} from 'src/auth/decorators/ownership.decorator';
import { IS_PUBLIC_KEY } from 'src/utils/constants';

/**
 * Contrato de posse (TRA-220). Os IDOR de /addresses e /assets (TRA-211)
 * nasceram de rotas com id na URL sem nenhuma checagem de dono. Toda rota
 * com parâmetro de caminho precisa declarar uma destas saídas:
 *   - @Roles(...)         restrita a papel (admin/editor);
 *   - @Public()           sem usuário;
 *   - @OwnershipChecked() posse verificada (e diz como);
 *   - @NotUserScoped()    id de recurso global (catálogo, CEP...).
 */
function controllerFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) return controllerFiles(full);
		return entry.endsWith('.controller.ts') ? [full] : [];
	});
}

type RouteRow = { route: string; declared: string | null };

function routesWithParams(): RouteRow[] {
	const srcRoot = join(__dirname, '..');
	const rows: RouteRow[] = [];
	for (const file of controllerFiles(srcRoot)) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const exported = require(file);
		for (const candidate of Object.values(exported)) {
			if (typeof candidate !== 'function') continue;
			const basePath = Reflect.getMetadata(PATH_METADATA, candidate);
			if (basePath === undefined) continue;
			const proto = (candidate as any).prototype;
			for (const name of Object.getOwnPropertyNames(proto)) {
				const handler = proto[name];
				if (typeof handler !== 'function' || name === 'constructor') continue;
				const path = Reflect.getMetadata(PATH_METADATA, handler);
				const method = Reflect.getMetadata(METHOD_METADATA, handler);
				if (path === undefined || method === undefined) continue;
				const paths: string[] = Array.isArray(path) ? path : [String(path)];
				if (!paths.some((p) => p.includes(':'))) continue;

				const meta = (key: string) =>
					Reflect.getMetadata(key, handler) ??
					Reflect.getMetadata(key, candidate);
				const ownership: OwnershipDeclaration | undefined = meta(OWNERSHIP_KEY);
				const declared = meta(ROLES_KEY)
					? 'roles'
					: meta(IS_PUBLIC_KEY)
						? 'public'
						: ownership?.how?.trim()
							? `ownership:${ownership.scope}`
							: null;
				rows.push({
					route: `${RequestMethod[method]} /${basePath}/${paths.join('|')} (${relative(srcRoot, file)} → ${name})`,
					declared,
				});
			}
		}
	}
	return rows;
}

describe('Contrato de posse das rotas com id (TRA-220)', () => {
	const rows = routesWithParams();

	it('encontra as rotas com parâmetro de caminho', () => {
		expect(rows.length).toBeGreaterThan(40);
	});

	it('toda rota com id declara Roles, Public, OwnershipChecked ou NotUserScoped', () => {
		const undeclared = rows
			.filter((row) => !row.declared)
			.map((row) => row.route);
		expect(undeclared).toEqual([]);
	});
});
