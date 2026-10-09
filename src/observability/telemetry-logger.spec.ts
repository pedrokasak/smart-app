import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import {
	InMemoryLogRecordExporter,
	LoggerProvider,
	SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { TelemetryLogger } from 'src/observability/telemetry-logger';

describe('TelemetryLogger (TRA-222)', () => {
	const exporter = new InMemoryLogRecordExporter();
	const provider = new LoggerProvider({
		processors: [new SimpleLogRecordProcessor({ exporter })],
	});

	beforeAll(() => {
		logs.setGlobalLoggerProvider(provider);
	});

	afterAll(async () => {
		await provider.shutdown();
		logs.disable();
	});

	beforeEach(() => {
		exporter.reset();
		jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
		jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
	});

	afterEach(() => jest.restoreAllMocks());

	const records = () => exporter.getFinishedLogRecords();

	it('manda o log com o contexto do Nest', () => {
		new TelemetryLogger().log('Server ready', 'Bootstrap');

		expect(records()).toHaveLength(1);
		expect(records()[0].body).toBe('Server ready');
		expect(records()[0].severityNumber).toBe(SeverityNumber.INFO);
		expect(records()[0].severityText).toBe('LOG');
		expect(records()[0].attributes).toEqual({ 'log.context': 'Bootstrap' });
	});

	it('separa stack e contexto no error', () => {
		new TelemetryLogger().error('Falhou', 'Error: x\n    at y', 'RiService');

		expect(records()[0].severityNumber).toBe(SeverityNumber.ERROR);
		expect(records()[0].attributes).toEqual({
			'log.context': 'RiService',
			'exception.stacktrace': 'Error: x\n    at y',
		});
	});

	it('usa a mensagem e a stack de um Error', () => {
		const error = new Error('boom');
		new TelemetryLogger().error(error);

		expect(records()[0].body).toBe('boom');
		expect(records()[0].attributes['exception.stacktrace']).toBe(error.stack);
	});

	it('serializa objeto como JSON', () => {
		new TelemetryLogger().warn({ queue: 'notifications', waiting: 12 });

		expect(records()[0].body).toBe('{"queue":"notifications","waiting":12}');
		expect(records()[0].severityNumber).toBe(SeverityNumber.WARN);
	});

	// Nível desligado no console também não sai por OTLP.
	it('respeita os níveis configurados', () => {
		const logger = new TelemetryLogger();
		logger.setLogLevels(['error']);

		logger.log('ignorado');
		logger.debug('ignorado');
		logger.error('sai');

		expect(records().map((record) => record.body)).toEqual(['sai']);
	});

	it('continua escrevendo no console', () => {
		new TelemetryLogger().log('no console', 'Ctx');

		expect(process.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining('no console')
		);
	});
});
