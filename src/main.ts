import { config } from 'dotenv';
config();
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { urlDevelopment, urlProduction } from './env';
// import { Transport, MicroserviceOptions } from '@nestjs/microservices';

async function bootstrap() {
	const app = await NestFactory.create(AppModule);
	// app.connectMicroservice<MicroserviceOptions>({
	// 	transport: Transport.KAFKA,
	// 	options: {
	// 		client: {
	// 			brokers: ['localhost:9092'], // Endereço do seu broker Kafka
	// 		},
	// 		consumer: {
	// 			groupId: 'your-group-id',
	// 		},
	// 	},
	// });

	// await app.startAllMicroservices();
	app.enableCors({
		origin: [urlProduction, urlDevelopment], // Permite o frontend acessar
		methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
		allowedHeaders: 'Content-Type, Authorization',
		credentials: true, // Permite cookies e headers de autenticação
	});

	app.useGlobalPipes(new ValidationPipe());

	await app.listen(3000);
}
bootstrap();
