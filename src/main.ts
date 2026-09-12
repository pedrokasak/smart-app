import { config } from 'dotenv';
config();
import * as bodyParser from 'body-parser';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { urlDevelopment, urlProduction } from 'src/env';

async function bootstrap() {
	const app = await NestFactory.create(AppModule, {
		bodyParser: false,
	});

	if (!(global as any).crypto) {
		(global as any).crypto = require('crypto');
	}

	app.use('/webhooks/stripe', bodyParser.raw({ type: 'application/json' }));
	app.use(bodyParser.json({ limit: '1mb' }));

	const corsOrigins = [
		urlDevelopment,
		urlProduction,
		'https://trackerr.com.br',
		'https://www.trackerr.com.br',
		'https://api.trackerr.com.br',
		...['3000', '5173', '8080'].flatMap((port) => [
			`http://localhost:${port}`,
			`http://127.0.0.1:${port}`,
		]),
	];

	app.enableCors({
		origin: corsOrigins,
		methods: 'GET,PUT,PATCH,POST,DELETE',
		allowedHeaders: [
			'Content-Type',
			'Authorization',
			'Accept',
			'stripe-signature',
		],
		credentials: true,
	});

	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			forbidNonWhitelisted: true,
			transform: true,
		})
	);

	const port = process.env.PORT || 3000;

	const configSwagger = new DocumentBuilder()
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

	const document = SwaggerModule.createDocument(app, configSwagger);
	SwaggerModule.setup('api', app, document);

	await app.listen(port, '0.0.0.0');
	console.log(`Nest application is listening on port ${port}`);
}
bootstrap();
