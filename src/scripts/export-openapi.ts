import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { buildOpenApiDocument } from 'src/common/openapi/build-openapi-document';

/**
 * Grava o contrato OpenAPI em um arquivo, para o app mobile gerar os tipos.
 *
 * `preview: true` monta o grafo de módulos sem instanciar providers: não abre
 * conexão com Mongo ou Redis, então roda sem nenhuma infraestrutura. O módulo
 * é importado depois de marcar o ambiente de teste, único em que `env.ts` não
 * exige os segredos de produção, que aqui nunca são usados.
 */
async function exportOpenApi(outputPath: string): Promise<void> {
	process.env.NODE_ENV = 'test';
	const { AppModule } = await import('src/app.module');
	const app = await NestFactory.create(AppModule, {
		preview: true,
		logger: ['error'],
	});
	const document = buildOpenApiDocument(app);
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
	console.log(
		`OpenAPI: ${Object.keys(document.paths).length} rotas em ${outputPath}`
	);
}

exportOpenApi(resolve(process.argv[2] ?? 'openapi.json'))
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
