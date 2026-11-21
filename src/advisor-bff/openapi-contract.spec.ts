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

		const upToDate =
			stableStringify(committed) === stableStringify(advisorDocument);

		if (!upToDate) {
			throw new Error(
				'Contrato do Advisor desatualizado: rode npm run export:openapi:advisor'
			);
		}
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
