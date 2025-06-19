import { config } from 'dotenv';
config();
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { urlDevelopment, urlProduction } from './env';

async function bootstrap() {
	const app = await NestFactory.create(AppModule);

	app.enableCors({
		origin: [urlProduction, urlDevelopment],
		methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
		allowedHeaders: 'Content-Type, Authorization',
		credentials: true,
	});

	app.useGlobalPipes(new ValidationPipe());

	await app.listen(3000);
}
bootstrap();
