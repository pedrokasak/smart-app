import {
	ArgumentsHost,
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Logger,
	NotFoundException,
	PayloadTooLargeException,
	UnprocessableEntityException,
} from '@nestjs/common';
import {
	ClientActionForbiddenError,
	ClientNotAccessibleError,
} from 'src/advisor/application/access-errors';
import {
	AlreadyOwnsOrganizationError,
	OrganizationRuleError,
} from 'src/advisor/application/organization.service';
import { NoActiveConsentError } from 'src/advisor/application/shared-portfolio.service';
import { InvalidCursorError } from 'src/advisor/application/ports/store-errors';
import {
	InvalidTransactionError,
	OversellError,
} from 'src/advisor/application/transaction.service';
import { CsvRejectedError } from 'src/advisor/application/csv/csv-import.service';
import { InvalidInviteError } from 'src/advisor/application/invite.service';
import { planCapabilityDenied } from 'src/subscription/capabilities/plan-capability.guard';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';

function run(exception: unknown): { status: number; body: any } {
	let status = 0;
	let body: unknown;
	const res = {
		status(code: number) {
			status = code;
			return this;
		},
		json(payload: unknown) {
			body = payload;
		},
	};
	const host = {
		switchToHttp: () => ({ getResponse: () => res }),
	} as unknown as ArgumentsHost;
	new AdvisorBffExceptionFilter().catch(exception, host);
	return { status, body };
}

describe('AdvisorBffExceptionFilter', () => {
	beforeEach(() => {
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
	});
	afterEach(() => jest.restoreAllMocks());

	it('turns ClientNotAccessibleError into a bare 404 without reason', () => {
		const { status, body } = run(new ClientNotAccessibleError());
		expect(status).toBe(404);
		expect(body).toEqual({ statusCode: 404, error: 'NOT_FOUND' });
	});

	it('turns a service NotFoundException into the same bare 404', () => {
		const { status, body } = run(new NotFoundException('invite 123 unknown'));
		expect(status).toBe(404);
		expect(body).toEqual({ statusCode: 404, error: 'NOT_FOUND' });
	});

	it('keeps ACTION_FORBIDDEN as a 403 with its reason', () => {
		const { status, body } = run(new ClientActionForbiddenError());
		expect(status).toBe(403);
		expect(body).toEqual({
			statusCode: 403,
			error: 'FORBIDDEN',
			reason: 'ACTION_FORBIDDEN',
		});
	});

	it('maps organization rule errors by their reason and status', () => {
		expect(run(new OrganizationRuleError('EMAIL_NOT_VERIFIED'))).toEqual({
			status: 403,
			body: {
				statusCode: 403,
				error: 'FORBIDDEN',
				reason: 'EMAIL_NOT_VERIFIED',
			},
		});
		expect(run(new OrganizationRuleError('INVALID_NAME')).status).toBe(400);
		expect(run(new AlreadyOwnsOrganizationError())).toEqual({
			status: 409,
			body: {
				statusCode: 409,
				error: 'CONFLICT',
				reason: 'ALREADY_OWNS_ORGANIZATION',
			},
		});
	});

	it('reads the reason from the response body of service errors', () => {
		const { status, body } = run(new InvalidInviteError('INVALID_EMAIL'));
		expect(status).toBe(400);
		expect(body).toEqual({
			statusCode: 400,
			error: 'BAD_REQUEST',
			reason: 'INVALID_EMAIL',
		});
		expect(
			run(new ConflictException({ reason: 'PENDING_INVITE' })).body
		).toEqual({ statusCode: 409, error: 'CONFLICT', reason: 'PENDING_INVITE' });
	});

	it('exposes the rule errors of a transaction as details', () => {
		const { status, body } = run(
			new InvalidTransactionError(['INVALID_PRICE', 'DATE_IN_FUTURE'])
		);
		expect(status).toBe(422);
		expect(body).toEqual({
			statusCode: 422,
			error: 'UNPROCESSABLE_ENTITY',
			reason: 'INVALID_TRANSACTION',
			details: { errors: ['INVALID_PRICE', 'DATE_IN_FUTURE'] },
		});
	});

	it('exposes the rejected CSV lines as details', () => {
		const errors = [{ line: 3, code: 'WRONG_COLUMN_COUNT' }];
		const { status, body } = run(new CsvRejectedError(errors as any));
		expect(status).toBe(422);
		expect(body).toMatchObject({
			reason: 'CSV_REJECTED',
			details: { errors },
		});
	});

	it('exposes symbol and trade date of an oversell as details', () => {
		const { body } = run(
			new OversellError({ symbol: 'PETR4', tradeDate: '2026-01-10' })
		);
		expect(body).toEqual({
			statusCode: 422,
			error: 'UNPROCESSABLE_ENTITY',
			reason: 'OVERSELL',
			details: { symbol: 'PETR4', tradeDate: '2026-01-10' },
		});
	});

	it('maps an invalid pagination cursor to 400 INVALID_CURSOR', () => {
		expect(run(new InvalidCursorError())).toEqual({
			status: 400,
			body: {
				statusCode: 400,
				error: 'BAD_REQUEST',
				reason: 'INVALID_CURSOR',
			},
		});
	});

	it('keeps the stable error code of the plan capability denial', () => {
		const { status, body } = run(planCapabilityDenied('advisor.portal'));
		expect(status).toBe(403);
		expect(body).toEqual({
			statusCode: 403,
			error: 'PLAN_CAPABILITY_REQUIRED',
		});
	});

	it('normalizes validation errors without leaking the Nest body shape', () => {
		const { status, body } = run(
			new BadRequestException(['name must be a string'])
		);
		expect(status).toBe(400);
		expect(body).toEqual({ statusCode: 400, error: 'BAD_REQUEST' });
	});

	it('passes other HttpExceptions with their status', () => {
		expect(run(new ForbiddenException('Invalid organization header'))).toEqual({
			status: 403,
			body: { statusCode: 403, error: 'FORBIDDEN' },
		});
		expect(run(new UnprocessableEntityException()).status).toBe(422);
	});

	it('turns NoActiveConsentError into the bare 404 (not a 403)', () => {
		expect(run(new NoActiveConsentError())).toEqual({
			status: 404,
			body: { statusCode: 404, error: 'NOT_FOUND' },
		});
	});

	it('maps the Multer size refusal (413) to FILE_TOO_LARGE', () => {
		expect(run(new PayloadTooLargeException('File too large'))).toEqual({
			status: 413,
			body: {
				statusCode: 413,
				error: 'PAYLOAD_TOO_LARGE',
				reason: 'FILE_TOO_LARGE',
			},
		});
	});

	it('keeps the reason of a duplicate import conflict', () => {
		expect(
			run(new ConflictException({ reason: 'DUPLICATE_IMPORT' })).body
		).toEqual({
			statusCode: 409,
			error: 'CONFLICT',
			reason: 'DUPLICATE_IMPORT',
		});
	});

	it('answers 500 without message or stack for an unknown error, logging it', () => {
		const secret = new Error('connection string mongodb://user:pw@host');
		const { status, body } = run(secret);
		expect(status).toBe(500);
		expect(body).toEqual({
			statusCode: 500,
			error: 'INTERNAL_SERVER_ERROR',
		});
		expect(JSON.stringify(body)).not.toContain('mongodb');
		expect(JSON.stringify(body)).not.toContain('at ');
		expect(Logger.prototype.error).toHaveBeenCalled();
	});

	it('logs only the class name and frames of an unknown error, never its message', () => {
		run(new Error('smtp down for joao.silva@exemplo.com'));
		const logged = (Logger.prototype.error as jest.Mock).mock.calls
			.flat()
			.join('\n');
		expect(logged).toContain('Error');
		expect(logged).toMatch(/\bat /);
		expect(logged).not.toContain('joao.silva');
		expect(logged).not.toContain('smtp down');
	});

	it('handles a thrown non-Error value as a 500', () => {
		expect(run('boom').status).toBe(500);
	});
});
