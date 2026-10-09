/**
 * Configuração do OpenTelemetry a partir do ambiente (TRA-222).
 *
 * Função pura, separada do bootstrap, para o teste cobrir as decisões sem
 * subir o SDK. A telemetria só liga com um endpoint OTLP explícito: em dev,
 * teste e CI nada é exportado e o server sobe igual a antes.
 *
 * Variáveis (nomes do padrão OpenTelemetry, para qualquer backend):
 *   OTEL_EXPORTER_OTLP_ENDPOINT   ex.: http://trackerr-otel-collector:4318
 *   OTEL_SDK_DISABLED=true        desliga mesmo com endpoint
 *   OTEL_SERVICE_NAME             padrão: trackerr-server
 *   OTEL_DEPLOYMENT_ENVIRONMENT   padrão: NODE_ENV
 *   SOURCE_COMMIT                 versão (o Coolify injeta o commit)
 */
export interface TelemetryConfig {
	enabled: boolean;
	endpoint: string;
	serviceName: string;
	serviceVersion: string;
	environment: string;
	metricIntervalMs: number;
}

const DEFAULT_SERVICE_NAME = 'trackerr-server';
const DEFAULT_METRIC_INTERVAL_MS = 30_000;

/** Rotas que não viram trace: health check do Coolify e do monitor externo. */
export const UNTRACED_PATHS: ReadonlySet<string> = new Set(['/health']);

export function telemetryConfigFrom(env: NodeJS.ProcessEnv): TelemetryConfig {
	const endpoint = String(env.OTEL_EXPORTER_OTLP_ENDPOINT || '')
		.trim()
		.replace(/\/+$/, '');
	const disabled =
		String(env.OTEL_SDK_DISABLED || '').toLowerCase() === 'true' ||
		env.NODE_ENV === 'test';

	return {
		enabled: Boolean(endpoint) && !disabled,
		endpoint,
		serviceName:
			String(env.OTEL_SERVICE_NAME || '').trim() || DEFAULT_SERVICE_NAME,
		serviceVersion:
			String(env.SOURCE_COMMIT || '')
				.trim()
				.slice(0, 12) || 'unknown',
		environment:
			String(env.OTEL_DEPLOYMENT_ENVIRONMENT || '').trim() ||
			String(env.NODE_ENV || '').trim() ||
			'development',
		metricIntervalMs: positiveInt(
			env.OTEL_METRIC_EXPORT_INTERVAL,
			DEFAULT_METRIC_INTERVAL_MS
		),
	};
}

/** `GET /health?x=1` também é health check. */
export function isUntracedPath(url: string | undefined): boolean {
	const path = String(url || '').split('?')[0];
	return UNTRACED_PATHS.has(path);
}

function positiveInt(raw: string | undefined, fallback: number): number {
	const value = Number(raw);
	return Number.isInteger(value) && value > 0 ? value : fallback;
}
