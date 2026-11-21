import { INestApplication, Type } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/** Prefixo das rotas do portal do assessor, fora do contrato principal. */
export const ADVISOR_PATH_PREFIX = '/advisor/v1';

export interface OpenApiDocumentOptions {
	/** Restringe o documento aos módulos informados. */
	include?: Type<unknown>[];
	/** Remove os paths que começam com algum destes prefixos. */
	excludePathPrefixes?: string[];
	title?: string;
	version?: string;
}

/**
 * Documento OpenAPI da API, usado pelo Swagger e pela exportação do contrato.
 * Sem opções é o contrato principal (mobile e `/docs`), que não inclui o BFF
 * do assessor.
 */
export function buildOpenApiDocument(
	app: INestApplication,
	options: OpenApiDocumentOptions = {}
): OpenAPIObject {
	const excludePathPrefixes = options.excludePathPrefixes ?? [
		ADVISOR_PATH_PREFIX,
	];
	const config = new DocumentBuilder()
		.setTitle(options.title ?? 'TrackerInvest API')
		.setDescription('The TrackerInvest API description')
		.addTag('tracker-invest-api')
		.setVersion(options.version ?? '1.0')
		.addBearerAuth(
			{
				type: 'http',
				scheme: 'bearer',
				bearerFormat: 'JWT',
			},
			'access-token'
		)
		.addBasicAuth()
		.build();

	const document = SwaggerModule.createDocument(app, config, {
		include: options.include,
	});
	return excludePaths(document, excludePathPrefixes);
}

/** Contrato do portal do assessor: só o `AdvisorBffModule`, versionado à parte. */
export function buildAdvisorOpenApiDocument(
	app: INestApplication
): OpenAPIObject {
	// Import tardio: o script de exportação só marca NODE_ENV=test depois de
	// carregar este arquivo, e o módulo puxa `env.ts`, que valida o ambiente.
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { AdvisorBffModule } = require('src/advisor-bff/advisor-bff.module');
	return buildOpenApiDocument(app, {
		include: [AdvisorBffModule],
		excludePathPrefixes: [],
		title: 'Trackerr Advisor API',
		version: '1.0.0',
	});
}

function excludePaths(
	document: OpenAPIObject,
	prefixes: string[]
): OpenAPIObject {
	if (prefixes.length === 0) return document;
	const removed: Record<string, unknown> = {};
	const kept: Record<string, unknown> = {};
	for (const [path, item] of Object.entries(document.paths)) {
		const target = prefixes.some((prefix) => path.startsWith(prefix))
			? removed
			: kept;
		target[path] = item;
	}
	if (Object.keys(removed).length === 0) return document;

	// Os schemas só alcançáveis pelos paths removidos saem junto: o BFF não
	// pode vazar para o contrato do mobile nem por `components`.
	const schemas = document.components?.schemas ?? {};
	const stillUsed = reachableSchemas(kept, schemas);
	const usedByRemoved = reachableSchemas(removed, schemas);
	const prunedSchemas = Object.fromEntries(
		Object.entries(schemas).filter(
			([name]) => stillUsed.has(name) || !usedByRemoved.has(name)
		)
	);
	return {
		...document,
		paths: kept as OpenAPIObject['paths'],
		components: { ...document.components, schemas: prunedSchemas },
	};
}

function reachableSchemas(
	root: unknown,
	schemas: Record<string, unknown>
): Set<string> {
	const found = new Set<string>();
	const pending: unknown[] = [root];
	while (pending.length > 0) {
		const node = pending.pop();
		if (Array.isArray(node)) {
			pending.push(...node);
		} else if (node && typeof node === 'object') {
			for (const [key, value] of Object.entries(node)) {
				if (key === '$ref' && typeof value === 'string') {
					const name = value.replace('#/components/schemas/', '');
					if (!found.has(name) && name in schemas) {
						found.add(name);
						pending.push(schemas[name]);
					}
				} else {
					pending.push(value);
				}
			}
		}
	}
	return found;
}
