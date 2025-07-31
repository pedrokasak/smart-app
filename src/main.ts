import { config } from 'dotenv';
config();
import * as bodyParser from 'body-parser';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { urlDevelopment, urlProduction } from './env';

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

	app.use(bodyParser.json());

	app.use('/webhooks/stripe', bodyParser.raw({ type: '*/*' }));

	await app.listen(3000);
}
bootstrap();
