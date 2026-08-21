import { of, throwError } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { TrackerrIaRagErasureAdapter } from 'src/users/infrastructure/trackerr-ia-rag-erasure.adapter';

describe('TrackerrIaRagErasureAdapter (TRA-78)', () => {
	let httpService: { post: jest.Mock };
	let adapter: TrackerrIaRagErasureAdapter;

	beforeEach(() => {
		httpService = { post: jest.fn() };
		adapter = new TrackerrIaRagErasureAdapter(
			httpService as unknown as HttpService
		);
		jest.spyOn(adapter as any, 'delay').mockResolvedValue(undefined);
	});

	it('reports the counts returned by trackerr-ia on success', async () => {
		httpService.post.mockReturnValue(
			of({ data: { chunks_deleted: 9, audit_rows_anonymized: 2 } })
		);

		const result = await adapter.eraseUserData('user-1');

		expect(result).toEqual({
			erased: true,
			chunksDeleted: 9,
			auditRowsAnonymized: 2,
		});
		expect(httpService.post).toHaveBeenCalledTimes(1);
		const [url, body] = httpService.post.mock.calls[0];
		expect(url).toContain('/api/rag/erase');
		expect(body).toEqual({ user_id: 'user-1' });
	});

	it('retries a transient failure and succeeds without a second erase call being unsafe', async () => {
		// O endpoint e idempotente, entao repetir apos timeout e seguro — e
		// exatamente por isso o retry existe.
		httpService.post
			.mockReturnValueOnce(throwError(() => new Error('ETIMEDOUT')))
			.mockReturnValueOnce(
				of({ data: { chunks_deleted: 3, audit_rows_anonymized: 1 } })
			);

		const result = await adapter.eraseUserData('user-1');

		expect(result.erased).toBe(true);
		expect(httpService.post).toHaveBeenCalledTimes(2);
	});

	it('gives up after 3 attempts and reports failure instead of pretending success', async () => {
		// O ponto da issue: exclusao que falha em silencio e o mesmo que nao
		// ter exclusao. Tem que voltar erased:false.
		httpService.post.mockReturnValue(
			throwError(() => new Error('ECONNREFUSED'))
		);

		const result = await adapter.eraseUserData('user-1');

		expect(result.erased).toBe(false);
		expect(result.failureReason).toBe('ECONNREFUSED');
		expect(httpService.post).toHaveBeenCalledTimes(3);
	});

	it('logs the final failure at error level so it can raise an alert', async () => {
		// Warn seria engolido no ruido. Dado pessoal ficou pra tras: precisa
		// acionar alguem.
		httpService.post.mockReturnValue(throwError(() => new Error('boom')));
		const errorSpy = jest
			.spyOn((adapter as any).logger, 'error')
			.mockImplementation(() => undefined);

		await adapter.eraseUserData('user-42');

		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy.mock.calls[0][0]).toContain('user-42');
	});

	it('does not call trackerr-ia at all for an empty userId', async () => {
		const result = await adapter.eraseUserData('');

		expect(result).toEqual({ erased: false, failureReason: 'empty_user_id' });
		expect(httpService.post).not.toHaveBeenCalled();
	});
});
