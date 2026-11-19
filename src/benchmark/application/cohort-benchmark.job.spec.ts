describe('CohortBenchmarkJob (ADR-003, TRA-60)', () => {
	const load = (enabled: boolean) => {
		jest.resetModules();
		jest.doMock('src/env', () => ({ benchmarkCohortJobEnabled: enabled }));
		const { CohortBenchmarkJob } = jest.requireActual<
			typeof import('src/benchmark/application/cohort-benchmark.job')
		>('src/benchmark/application/cohort-benchmark.job');
		const service = {
			publishPeriod: jest.fn().mockResolvedValue({ members: 0, cohorts: 0 }),
		};
		return { job: new CohortBenchmarkJob(service as never), service };
	};

	afterEach(() => {
		jest.dontMock('src/env');
	});

	it('does nothing while the flag is off (default)', async () => {
		const { job, service } = load(false);

		await job.run();

		expect(service.publishPeriod).not.toHaveBeenCalled();
	});

	it('publishes the month when the flag is on', async () => {
		const { job, service } = load(true);

		await job.run();

		expect(service.publishPeriod).toHaveBeenCalledTimes(1);
	});

	it('swallows a failure instead of taking the process down', async () => {
		const { job, service } = load(true);
		service.publishPeriod.mockRejectedValue(new Error('mongo fora'));

		await expect(job.run()).resolves.toBeUndefined();
	});
});
