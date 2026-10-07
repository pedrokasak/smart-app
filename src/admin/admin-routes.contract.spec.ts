import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from 'src/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { IS_PUBLIC_KEY } from 'src/utils/constants';

/**
 * Contrato das rotas administrativas (TRA-184).
 *
 * `RolesGuard` é opt-in: handler sem `@Roles` passa para qualquer usuário
 * autenticado. Hoje todas as rotas `/admin/*` declaram papel, mas nada impedia
 * a próxima de esquecer. Este teste falha o CI nesse caso.
 *
 * Autorização real é sempre o server (JwtAuthGuard global + RolesGuard). A
 * separação de host `admin.trackerr.com.br` no web é só UX
 * (`AdminHostRedirect`) e nunca é a barreira de segurança.
 */
function controllerFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) return controllerFiles(full);
		return entry.endsWith('.controller.ts') ? [full] : [];
	});
}

type AdminRoute = {
	label: string;
	hasRoles: boolean;
	isPublic: boolean;
	hasRolesGuard: boolean;
};

function adminRoutes(): AdminRoute[] {
	const srcRoot = join(__dirname, '..');
	const rows: AdminRoute[] = [];
	for (const file of controllerFiles(srcRoot)) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const exported = require(file);
		for (const candidate of Object.values(exported)) {
			if (typeof candidate !== 'function') continue;
			const basePath = Reflect.getMetadata(PATH_METADATA, candidate);
			if (typeof basePath !== 'string') continue;
			if (basePath !== 'admin' && !basePath.startsWith('admin/')) continue;

			const classGuards: unknown[] =
				Reflect.getMetadata(GUARDS_METADATA, candidate) ?? [];
			const proto = (candidate as any).prototype;
			for (const name of Object.getOwnPropertyNames(proto)) {
				const handler = proto[name];
				if (typeof handler !== 'function' || name === 'constructor') continue;
				if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) {
					continue;
				}
				const meta = (key: string) =>
					Reflect.getMetadata(key, handler) ??
					Reflect.getMetadata(key, candidate);
				const guards: unknown[] = [
					...classGuards,
					...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
				];
				const roles = meta(ROLES_KEY) as unknown[] | undefined;
				rows.push({
					label: `/${basePath} (${relative(srcRoot, file)} → ${name})`,
					hasRoles: Array.isArray(roles) && roles.length > 0,
					isPublic: !!meta(IS_PUBLIC_KEY),
					hasRolesGuard: guards.includes(RolesGuard),
				});
			}
		}
	}
	return rows;
}

describe('Contrato das rotas administrativas (TRA-184)', () => {
	const rows = adminRoutes();

	it('encontra as rotas de todos os controllers admin', () => {
		expect(rows.length).toBeGreaterThan(10);
	});

	it('toda rota admin declara @Roles', () => {
		expect(rows.filter((r) => !r.hasRoles).map((r) => r.label)).toEqual([]);
	});

	it('nenhuma rota admin é @Public', () => {
		expect(rows.filter((r) => r.isPublic).map((r) => r.label)).toEqual([]);
	});

	it('todo controller admin aplica RolesGuard', () => {
		expect(rows.filter((r) => !r.hasRolesGuard).map((r) => r.label)).toEqual(
			[]
		);
	});
});
