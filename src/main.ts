import { config } from 'dotenv';
config();
import * as bodyParser from 'body-parser';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { urlDevelopment, urlProduction, port } from './env';

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	if (!(global as any).crypto) {
		(global as any).crypto = require('crypto');
	}

	app.enableCors({
		origin: [urlProduction, urlDevelopment],
		methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
		allowedHeaders: 'Content-Type, Authorization',
		credentials: true,
	});

	app.useGlobalPipes(new ValidationPipe());

	app.use('/webhooks/stripe', bodyParser.raw({ type: 'application/json' }));

	app.use(bodyParser.json());

	await app.listen(port || 3000, '0.0.0.0');
}
bootstrap();
