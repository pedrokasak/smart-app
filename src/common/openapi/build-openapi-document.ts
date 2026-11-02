import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Documento OpenAPI da API, usado pelo Swagger e pela exportação do contrato. */
export function buildOpenApiDocument(app: INestApplication) {
	const config = new DocumentBuilder()
		.setTitle('TrackerInvest API')
		.setDescription('The TrackerInvest API description')
		.addTag('tracker-invest-api')
		.setVersion('1.0')
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

	return SwaggerModule.createDocument(app, config);
}
