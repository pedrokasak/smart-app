import { ForbiddenException } from '@nestjs/common';
import { BenchmarkController } from 'src/benchmark/benchmark.controller';

describe('BenchmarkController (ADR-003, TRA-60)', () => {
	const service = {
		getForUser: jest.fn().mockResolvedValue({ available: false }),
	};
	const controller = new BenchmarkController(service as never);

	beforeEach(() => service.getForUser.mockClear());

	it('asks for the cohort of the user in the token and nobody else', async () => {
		await controller.cohort({ user: { userId: 'u-1' } });
		expect(service.getForUser).toHaveBeenCalledWith('u-1');
	});

	it('accepts the other id claims the guard may set', async () => {
		await controller.cohort({ user: { sub: 'u-2' } });
		expect(service.getForUser).toHaveBeenCalledWith('u-2');
	});

	it('refuses a request without an authenticated user', () => {
		expect(() => controller.cohort({})).toThrow(ForbiddenException);
		expect(service.getForUser).not.toHaveBeenCalled();
	});
});
