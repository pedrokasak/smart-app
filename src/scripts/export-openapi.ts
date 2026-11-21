import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import {
	buildAdvisorOpenApiDocument,
	buildOpenApiDocument,
} from 'src/common/openapi/build-openapi-document';

/**
 * Grava o contrato OpenAPI em um arquivo, para o app mobile gerar os tipos.
 * Com `--advisor` grava o contrato do portal do assessor (`/advisor/v1`).
 *
 * `preview: true` monta o grafo de módulos sem instanciar providers: não abre
 * conexão com Mongo ou Redis, então roda sem nenhuma infraestrutura. O módulo
 * é importado depois de marcar o ambiente de teste, único em que `env.ts` não
 * exige os segredos de produção, que aqui nunca são usados.
 */
async function exportOpenApi(
	outputPath: string,
	advisor: boolean
): Promise<void> {
	process.env.NODE_ENV = 'test';
	const { AppModule } = await import('src/app.module');
	const app = await NestFactory.create(AppModule, {
		preview: true,
		logger: ['error'],
	});
	const document = advisor
		? buildAdvisorOpenApiDocument(app)
		: buildOpenApiDocument(app);
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
	console.log(
		`OpenAPI: ${Object.keys(document.paths).length} rotas em ${outputPath}`
	);
}

const args = process.argv.slice(2);
const advisor = args.includes('--advisor');
const target = args.find((arg) => !arg.startsWith('--'));

exportOpenApi(resolve(target ?? 'openapi.json'), advisor)
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
