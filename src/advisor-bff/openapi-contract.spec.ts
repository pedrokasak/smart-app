import { readFileSync } from 'fs';
import { resolve } from 'path';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from 'src/app.module';
import {
	ADVISOR_PATH_PREFIX,
	buildAdvisorOpenApiDocument,
	buildOpenApiDocument,
} from 'src/common/openapi/build-openapi-document';

const CONTRACT_PATH = resolve(__dirname, '../../openapi/advisor.json');
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'];

/** JSON canônico: chaves ordenadas, para a comparação ignorar a ordem. */
function stableStringify(value: unknown): string {
	return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, sortKeys(value[key])])
		);
	}
	return value;
}

/** O contrato gravado bate com o gerado, ignorando a ordem das chaves. */
function sameContract(committed: unknown, generated: unknown): boolean {
	return stableStringify(committed) === stableStringify(generated);
}

describe('contrato OpenAPI do Advisor', () => {
	let app: INestApplication;
	let advisorDocument: OpenAPIObject;
	let mainDocument: OpenAPIObject;

	beforeAll(async () => {
		// `preview: true` monta o grafo sem instanciar providers (sem Mongo).
		app = await NestFactory.create(AppModule, {
			preview: true,
			logger: ['error'],
		});
		advisorDocument = buildAdvisorOpenApiDocument(app);
		mainDocument = buildOpenApiDocument(app);
	}, 120_000);

	it('openapi/advisor.json está em dia com o código', () => {
		const committed = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));

		if (!sameContract(committed, advisorDocument)) {
			throw new Error(
				'Contrato do Advisor desatualizado: rode npm run export:openapi:advisor'
			);
		}
	});

	it('a comparação acusa uma mudança no contrato (o teste de drift funciona)', () => {
		const copy = JSON.parse(JSON.stringify(advisorDocument));
		expect(sameContract(copy, advisorDocument)).toBe(true);

		const [firstPath] = Object.keys(copy.paths);
		const [firstMethod] = Object.keys(copy.paths[firstPath]);
		copy.paths[firstPath][firstMethod].summary = 'mudou';
		expect(sameContract(copy, advisorDocument)).toBe(false);

		const reordered = JSON.parse(JSON.stringify(advisorDocument));
		reordered.info = Object.fromEntries(
			Object.entries(reordered.info).reverse()
		);
		expect(sameContract(reordered, advisorDocument)).toBe(true);
	});

	it('toda operação documenta 401 e 429; as de org ativa exigem x-org-id', () => {
		const missing: string[] = [];
		for (const [path, item] of Object.entries(advisorDocument.paths)) {
			for (const method of HTTP_METHODS) {
				const operation = item[method];
				if (!operation) continue;
				const label = `${method.toUpperCase()} ${path}`;
				for (const status of ['401', '429']) {
					if (!operation.responses?.[status])
						missing.push(`${label} ${status}`);
				}
				// As rotas do convidado (`/me/member-invites`) ficam sem org ativa.
				const orgScoped = [
					'/clients',
					'/invites',
					'/members',
					'/member-invites',
					'/me/membership',
				].some((scoped) => path.startsWith(`${ADVISOR_PATH_PREFIX}${scoped}`));
				const header = (operation.parameters ?? []).find(
					(p: any) => p.in === 'header' && p.name === 'x-org-id'
				) as any;
				if (orgScoped && header?.required !== true) {
					missing.push(`${label} x-org-id`);
				}
				if (!orgScoped && header) missing.push(`${label} unexpected x-org-id`);
			}
		}
		expect(missing).toEqual([]);
	});

	it('o documento principal não expõe nenhuma rota do Advisor', () => {
		const leaked = Object.keys(mainDocument.paths).filter((path) =>
			path.startsWith(ADVISOR_PATH_PREFIX)
		);

		expect(leaked).toEqual([]);
		expect(Object.keys(mainDocument.paths).length).toBeGreaterThan(0);
	});

	it('toda operação do Advisor tem resposta 2xx com schema ou 204', () => {
		const withoutSuccess: string[] = [];
		for (const [path, item] of Object.entries(advisorDocument.paths)) {
			for (const method of HTTP_METHODS) {
				const operation = item[method];
				if (!operation) continue;
				const responses = operation.responses ?? {};
				const ok = Object.entries(responses).some(
					([status, response]) =>
						status === '204' ||
						(/^2\d\d$/.test(status) &&
							Boolean((response as any).content?.['application/json']?.schema))
				);
				if (!ok) withoutSuccess.push(`${method.toUpperCase()} ${path}`);
			}
		}

		expect(withoutSuccess).toEqual([]);
		expect(Object.keys(advisorDocument.paths).length).toBeGreaterThan(0);
	});

	afterAll(async () => {
		await app?.close();
	});
});
