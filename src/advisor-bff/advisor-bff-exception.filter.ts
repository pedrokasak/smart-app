import {
	ArgumentsHost,
	Catch,
	ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClientNotAccessibleError } from 'src/advisor/application/access-errors';
import { InvalidCursorError } from 'src/advisor/application/ports/store-errors';
import type { ErrorResponseDto } from './dto/error-response.dto';

type ErrorBody = ErrorResponseDto;

const UPPER_SNAKE = /^[A-Z0-9_]+$/;

/**
 * Único ponto que traduz erro em resposta no BFF: `{ statusCode, error,
 * reason?, details? }`. Cliente, convite ou lote inexistente ou de outra org
 * vira o mesmo 404 (não revela existência). Erro desconhecido vira 500 sem
 * mensagem nem stack; o detalhe só vai para o log.
 */
@Catch()
export class AdvisorBffExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger(AdvisorBffExceptionFilter.name);

	catch(exception: unknown, host: ArgumentsHost): void {
		const res = host.switchToHttp().getResponse<Response>();
		const body = this.toBody(exception);
		res.status(body.statusCode).json(body);
	}

	private toBody(exception: unknown): ErrorBody {
		if (
			exception instanceof ClientNotAccessibleError ||
			exception instanceof NotFoundException
		) {
			return { statusCode: HttpStatus.NOT_FOUND, error: 'NOT_FOUND' };
		}
		if (exception instanceof InvalidCursorError) {
			return {
				statusCode: HttpStatus.BAD_REQUEST,
				error: 'BAD_REQUEST',
				reason: 'INVALID_CURSOR',
			};
		}
		if (exception instanceof HttpException) {
			return this.fromHttpException(exception);
		}
		this.logger.error(
			'Unhandled error in the advisor BFF',
			exception instanceof Error ? exception.stack : String(exception)
		);
		return {
			statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
			error: 'INTERNAL_SERVER_ERROR',
		};
	}

	private fromHttpException(exception: HttpException): ErrorBody {
		const statusCode = exception.getStatus();
		const raw = exception.getResponse();
		const payload: Record<string, unknown> =
			typeof raw === 'object' && raw !== null
				? (raw as Record<string, unknown>)
				: {};

		const body: ErrorBody = {
			statusCode,
			error: this.errorCodeOf(statusCode, payload),
		};
		const details = this.detailsOf(payload);
		const reason =
			this.reasonOf(exception, payload) ?? this.reasonFromShape(payload);
		if (reason !== undefined) body.reason = reason;
		if (details !== undefined) body.details = details;
		return body;
	}

	/** Mantém um `error` já estável (ex.: PLAN_CAPABILITY_REQUIRED). */
	private errorCodeOf(
		statusCode: number,
		payload: Record<string, unknown>
	): string {
		if (typeof payload.error === 'string' && UPPER_SNAKE.test(payload.error)) {
			return payload.error;
		}
		return HttpStatus[statusCode] ?? 'ERROR';
	}

	private reasonOf(
		exception: HttpException,
		payload: Record<string, unknown>
	): string | undefined {
		const onException = (exception as { reason?: unknown }).reason;
		if (typeof onException === 'string') return onException;
		return typeof payload.reason === 'string' ? payload.reason : undefined;
	}

	/**
	 * Os erros de transação, de CSV e de venda sem saldo não carregam `reason`
	 * próprio: o formato do corpo que o serviço já produz o identifica.
	 */
	private reasonFromShape(
		payload: Record<string, unknown>
	): string | undefined {
		if (Array.isArray(payload.errors)) {
			const csvRows = payload.errors.some(
				(e) => typeof e === 'object' && e !== null && 'line' in e
			);
			return csvRows ? 'CSV_REJECTED' : 'INVALID_TRANSACTION';
		}
		if ('symbol' in payload && 'tradeDate' in payload) return 'OVERSELL';
		return undefined;
	}

	private detailsOf(
		payload: Record<string, unknown>
	): Record<string, unknown> | undefined {
		if (Array.isArray(payload.errors)) return { errors: payload.errors };
		if ('symbol' in payload && 'tradeDate' in payload) {
			return { symbol: payload.symbol, tradeDate: payload.tradeDate };
		}
		return undefined;
	}
}
