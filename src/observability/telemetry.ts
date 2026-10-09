/**
 * Bootstrap do OpenTelemetry (TRA-222). Importado em `main.ts` antes de
 * qualquer outro módulo da aplicação: a auto-instrumentação troca funções de
 * `http`, `express`, `mongodb`, `mongoose` e `ioredis` no momento do
 * `require`, e módulo carregado antes dela fica sem trace.
 *
 * Roda em Bun (imagem de produção) e em Node. Conferido no Bun: spans de
 * HTTP de entrada e saída, Express, MongoDB, Mongoose e ioredis, com o
 * contexto propagado entre eles. O `fetch` nativo do Bun não é
 * instrumentado; as chamadas ao trackerr-ia usam axios (módulo `http`),
 * que é.
 *
 * Sem `OTEL_EXPORTER_OTLP_ENDPOINT` nada é iniciado (ver telemetry-config).
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import {
	isUntracedPath,
	telemetryConfigFrom,
} from 'src/observability/telemetry-config';

const config = telemetryConfigFrom(process.env);

export const telemetryEnabled = config.enabled;

if (config.enabled) {
	const sdk = new NodeSDK({
		resource: resourceFromAttributes({
			[ATTR_SERVICE_NAME]: config.serviceName,
			[ATTR_SERVICE_VERSION]: config.serviceVersion,
			// Ainda incubando na semconv; o nome é o do padrão.
			'deployment.environment.name': config.environment,
		}),
		traceExporter: new OTLPTraceExporter({
			url: `${config.endpoint}/v1/traces`,
		}),
		metricReaders: [
			new PeriodicExportingMetricReader({
				exporter: new OTLPMetricExporter({
					url: `${config.endpoint}/v1/metrics`,
				}),
				exportIntervalMillis: config.metricIntervalMs,
			}),
		],
		logRecordProcessors: [
			new BatchLogRecordProcessor({
				exporter: new OTLPLogExporter({ url: `${config.endpoint}/v1/logs` }),
			}),
		],
		instrumentations: [
			getNodeAutoInstrumentations({
				// Ruído sem valor de diagnóstico, e caro: todo acesso a arquivo
				// e toda conexão TCP virariam span.
				'@opentelemetry/instrumentation-fs': { enabled: false },
				'@opentelemetry/instrumentation-net': { enabled: false },
				'@opentelemetry/instrumentation-dns': { enabled: false },
				// Express 5 (Nest 11) roteia pelo pacote `router`: com as duas
				// instrumentações ligadas, cada camada vira dois spans. Fica a
				// do Express, só com o handler da rota (cada middleware do
				// Nest viraria um span por request).
				'@opentelemetry/instrumentation-router': { enabled: false },
				'@opentelemetry/instrumentation-express': {
					ignoreLayersType: [ExpressLayerType.MIDDLEWARE],
				},
				'@opentelemetry/instrumentation-http': {
					ignoreIncomingRequestHook: (request) => isUntracedPath(request.url),
				},
				// Valores das queries ficam de fora (padrão do instrumentador);
				// explícito aqui para ninguém ligar sem querer: filtro de
				// consulta carrega e-mail e CPF.
				'@opentelemetry/instrumentation-mongodb': {
					enhancedDatabaseReporting: false,
				},
			}),
		],
	});

	sdk.start();

	// O Coolify para o container com SIGTERM: o que estiver no buffer sai
	// antes do processo terminar. Ouvir o sinal tira o comportamento padrão
	// (encerrar), e o server não tem outro hook de shutdown; por isso, depois
	// de esvaziar o buffer (no máximo 5s), o sinal é reenviado. Como o
	// listener é `once`, o reenvio cai no padrão e o processo encerra com o
	// código de sempre.
	const flushThenExit = (signal: NodeJS.Signals) => {
		const timeout = new Promise((resolve) => setTimeout(resolve, 5_000));
		Promise.race([sdk.shutdown(), timeout])
			.catch(() => undefined)
			.finally(() => process.kill(process.pid, signal));
	};
	process.once('SIGTERM', flushThenExit);
	process.once('SIGINT', flushThenExit);
}
