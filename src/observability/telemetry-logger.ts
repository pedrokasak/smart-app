import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const SEVERITY: Record<LogLevel, SeverityNumber> = {
	verbose: SeverityNumber.TRACE,
	debug: SeverityNumber.DEBUG,
	log: SeverityNumber.INFO,
	warn: SeverityNumber.WARN,
	error: SeverityNumber.ERROR,
	fatal: SeverityNumber.FATAL,
};

/**
 * Logger do Nest que, além do console de sempre, manda cada linha por OTLP
 * (TRA-222). O SDK associa o registro ao span ativo, então o log no Loki
 * carrega o `trace_id` da requisição que o gerou.
 *
 * Sem SDK iniciado, `logs.getLogger` devolve um logger no-op: este logger
 * se comporta exatamente como o `ConsoleLogger`.
 */
export class TelemetryLogger extends ConsoleLogger {
	private readonly otel = logs.getLogger('trackerr-server');

	log(message: unknown, ...rest: unknown[]): void {
		super.log(message, ...rest);
		this.emit('log', message, rest);
	}

	warn(message: unknown, ...rest: unknown[]): void {
		super.warn(message, ...rest);
		this.emit('warn', message, rest);
	}

	error(message: unknown, ...rest: unknown[]): void {
		super.error(message, ...rest);
		this.emit('error', message, rest);
	}

	fatal(message: unknown, ...rest: unknown[]): void {
		super.fatal(message, ...rest);
		this.emit('fatal', message, rest);
	}

	debug(message: unknown, ...rest: unknown[]): void {
		super.debug(message, ...rest);
		this.emit('debug', message, rest);
	}

	verbose(message: unknown, ...rest: unknown[]): void {
		super.verbose(message, ...rest);
		this.emit('verbose', message, rest);
	}

	/**
	 * Mesmos argumentos do Nest: o último string é o contexto
	 * (`new Logger(Ctx.name)`), e em `error` o anterior pode ser a stack.
	 */
	private emit(level: LogLevel, message: unknown, rest: unknown[]): void {
		if (!this.isLevelEnabled(level)) return;
		const params = [...rest];
		const canHaveStack = level === 'error' || level === 'fatal';
		const last = params[params.length - 1];
		// `Logger.error(msg, err.stack)` sem contexto: o único argumento é a
		// stack, não o contexto (mesma regra do ConsoleLogger do Nest).
		const lastIsStack =
			canHaveStack && params.length === 1 && looksLikeStack(last);
		const context =
			typeof last === 'string' && !lastIsStack
				? (params.pop() as string)
				: this.context;
		const stack =
			canHaveStack && typeof params[params.length - 1] === 'string'
				? (params.pop() as string)
				: message instanceof Error
					? message.stack
					: undefined;

		const attributes: Record<string, string> = {};
		if (context) attributes['log.context'] = context;
		if (stack) attributes['exception.stacktrace'] = stack;

		this.otel.emit({
			severityNumber: SEVERITY[level],
			severityText: level.toUpperCase(),
			body: describe(message),
			attributes,
		});
	}
}

function looksLikeStack(value: unknown): boolean {
	return typeof value === 'string' && /\n\s+at /.test(value);
}

function describe(message: unknown): string {
	if (typeof message === 'string') return message;
	if (message instanceof Error) return message.message;
	try {
		return JSON.stringify(message);
	} catch {
		return String(message);
	}
}
