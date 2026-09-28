import {
	brapiGateState,
	brapiRequest,
	isBrapiRateLimit,
} from './brapi-request-gate';

const rateLimited = () =>
	Object.assign(new Error('429'), { response: { status: 429 } });

describe('brapiRequest (TRA-247)', () => {
	afterEach(() => {
		delete process.env.BRAPI_MAX_CONCURRENCY;
	});

	it('nunca deixa duas chamadas em voo no plano grátis', async () => {
		let inFlight = 0;
		let peak = 0;
		const task = async () => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight -= 1;
			return 'ok';
		};

		const results = await Promise.all(
			[1, 2, 3, 4].map(() => brapiRequest(task))
		);

		expect(results).toEqual(['ok', 'ok', 'ok', 'ok']);
		expect(peak).toBe(1);
		expect(brapiGateState()).toEqual({ active: 0, waiting: 0 });
	});

	it('respeita BRAPI_MAX_CONCURRENCY quando o plano permite mais', async () => {
		process.env.BRAPI_MAX_CONCURRENCY = '2';
		let inFlight = 0;
		let peak = 0;
		const task = async () => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight -= 1;
		};

		await Promise.all([1, 2, 3, 4].map(() => brapiRequest(task)));

		expect(peak).toBe(2);
	});

	it('repete em 429 e devolve quando a brapi libera', async () => {
		const task = jest
			.fn()
			.mockRejectedValueOnce(rateLimited())
			.mockResolvedValueOnce('ok');

		await expect(brapiRequest(task, { retryDelaysMs: [0, 0] })).resolves.toBe(
			'ok'
		);
		expect(task).toHaveBeenCalledTimes(2);
	});

	it('desiste depois das novas tentativas e libera a fila', async () => {
		const task = jest.fn().mockRejectedValue(rateLimited());

		await expect(brapiRequest(task, { retryDelaysMs: [0, 0] })).rejects.toThrow(
			'429'
		);
		expect(task).toHaveBeenCalledTimes(3);
		expect(brapiGateState()).toEqual({ active: 0, waiting: 0 });
	});

	it('outros erros não são repetidos', async () => {
		const task = jest.fn().mockRejectedValue(new Error('boom'));

		await expect(brapiRequest(task, { retryDelaysMs: [0, 0] })).rejects.toThrow(
			'boom'
		);
		expect(task).toHaveBeenCalledTimes(1);
	});

	it('reconhece o 429 da brapi', () => {
		expect(isBrapiRateLimit(rateLimited())).toBe(true);
		expect(isBrapiRateLimit(new Error('x'))).toBe(false);
	});
});
