import { config } from 'dotenv';
config();
import * as bodyParser from 'body-parser';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { urlDevelopment, urlProduction } from 'src/env';
import {
	SWAGGER_DOCS_PATH,
	buildCspMiddleware,
	isCspReportOnly,
} from 'src/security/http/content-security-policy';

async function bootstrap() {
	const app = await NestFactory.create(AppModule, {
		bodyParser: false,
	});

	if (!(global as any).crypto) {
		(global as any).crypto = require('crypto');
	}

	// `req.ip` só respeita x-forwarded-for quando o proxy é declarado confiável.
	// O rate limit depende disso pra identificar o cliente: sem esta linha e
	// atrás de um proxy, todo mundo compartilha o IP do proxy; lendo o header
	// sem ela, o cliente escolhe o próprio identificador e escapa do limite
	// (TRA-89). `1` = confia apenas no salto imediatamente à frente.
	app.getHttpAdapter().getInstance().set('trust proxy', 1);

	// Cabeçalhos de segurança. O CSP sai daqui e entra logo abaixo, com
	// política própria por rota (TRK-009) — `helmet()` continua respondendo
	// por HSTS, nosniff, referrer-policy e companhia.
	app.use(helmet({ contentSecurityPolicy: false }));

	// CSP (TRK-009). Report-only por padrão; `CSP_REPORT_ONLY=false` promove
	// para enforce sem mexer em código. A política das rotas JSON é
	// `default-src 'none'` — uma API que não renderiza nada não precisa
	// carregar nada. O Swagger recebe a sua, mais frouxa, escopada no path
	// dele; ver `content-security-policy.ts` para o porquê de cada diretiva.
	app.use(buildCspMiddleware(isCspReportOnly()));

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

	// Swagger fora de produção (TRA-89): publicar o mapa completo da API,
	// rotas administrativas incluídas, entrega de graça o levantamento que um
	// atacante teria que fazer na mão. Ligar em produção só com
	// ENABLE_SWAGGER=true e consciência do que isso expõe.
	const swaggerEnabled =
		process.env.NODE_ENV !== 'production' ||
		process.env.ENABLE_SWAGGER === 'true';

	if (swaggerEnabled) {
		setupSwagger(app);
	}

	await app.listen(port, '0.0.0.0');
	console.log(`Nest application is listening on port ${port}`);
}

function setupSwagger(app: Parameters<typeof SwaggerModule.setup>[1]): void {
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
	// Mesma constante que o CSP usa para escapar da política apertada
	// (TRK-009). Se o path mudar aqui, a política do Swagger acompanha.
	SwaggerModule.setup(SWAGGER_DOCS_PATH, app, document);
}
bootstrap();
