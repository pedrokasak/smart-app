import {
	isUntracedPath,
	telemetryConfigFrom,
} from 'src/observability/telemetry-config';

describe('telemetryConfigFrom (TRA-222)', () => {
	const prod = {
		NODE_ENV: 'production',
		OTEL_EXPORTER_OTLP_ENDPOINT: 'http://trackerr-otel-collector:4318/',
		SOURCE_COMMIT: '45d9210abcdef0123456789',
	};

	it('liga com endpoint e usa os padrões do Trackerr', () => {
		expect(telemetryConfigFrom(prod)).toEqual({
			enabled: true,
			endpoint: 'http://trackerr-otel-collector:4318',
			serviceName: 'trackerr-server',
			serviceVersion: '45d9210abcde',
			environment: 'production',
			metricIntervalMs: 30_000,
		});
	});

	// Dev, CI e testes não exportam nada nem tentam conectar.
	it('fica desligada sem endpoint', () => {
		expect(telemetryConfigFrom({ NODE_ENV: 'production' }).enabled).toBe(false);
	});

	it('fica desligada em teste mesmo com endpoint', () => {
		expect(telemetryConfigFrom({ ...prod, NODE_ENV: 'test' }).enabled).toBe(
			false
		);
	});

	it('respeita OTEL_SDK_DISABLED', () => {
		expect(
			telemetryConfigFrom({ ...prod, OTEL_SDK_DISABLED: 'TRUE' }).enabled
		).toBe(false);
	});

	it('aceita nome, ambiente e intervalo do ambiente', () => {
		const config = telemetryConfigFrom({
			...prod,
			OTEL_SERVICE_NAME: 'trackerr-worker',
			OTEL_DEPLOYMENT_ENVIRONMENT: 'staging',
			OTEL_METRIC_EXPORT_INTERVAL: '10000',
		});

		expect(config.serviceName).toBe('trackerr-worker');
		expect(config.environment).toBe('staging');
		expect(config.metricIntervalMs).toBe(10_000);
	});

	it('ignora intervalo inválido', () => {
		expect(
			telemetryConfigFrom({ ...prod, OTEL_METRIC_EXPORT_INTERVAL: '-5' })
				.metricIntervalMs
		).toBe(30_000);
	});

	it('marca a versão como unknown sem commit', () => {
		expect(
			telemetryConfigFrom({ ...prod, SOURCE_COMMIT: undefined }).serviceVersion
		).toBe('unknown');
	});
});

describe('isUntracedPath', () => {
	it.each([
		['/health', true],
		['/health?probe=coolify', true],
		['/healthz', false],
		['/portfolio/health', false],
		[undefined, false],
	])('%s -> %s', (url, expected) => {
		expect(isUntracedPath(url)).toBe(expected);
	});
});
