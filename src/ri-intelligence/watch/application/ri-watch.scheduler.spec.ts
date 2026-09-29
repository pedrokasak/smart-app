import { RiWatchConfig } from 'src/ri-intelligence/watch/application/ri-watch.config';
import { RiWatchNotifier } from 'src/ri-intelligence/watch/application/ri-watch.notifier';
import { RiWatchScheduler } from 'src/ri-intelligence/watch/application/ri-watch.scheduler';
import { RiWatchService } from 'src/ri-intelligence/watch/application/ri-watch.service';

describe('RiWatchScheduler (TRA-240)', () => {
	let service: { scan: jest.Mock; processPending: jest.Mock };
	let notifier: { notifyProcessed: jest.Mock };
	let config: RiWatchConfig;

	const makeScheduler = () =>
		new RiWatchScheduler(
			service as unknown as RiWatchService,
			notifier as unknown as RiWatchNotifier,
			config
		);

	beforeEach(() => {
		service = {
			scan: jest.fn().mockResolvedValue({
				tickers: 2,
				registered: 1,
				failedTickers: 0,
				dailyFeed: 'ok',
			}),
			processPending: jest
				.fn()
				.mockResolvedValue({ summarized: 1, skipped: 0, failed: 0 }),
		};
		notifier = {
			notifyProcessed: jest
				.fn()
				.mockResolvedValue({ documents: 1, events: 3, skipped: 0, failed: 0 }),
		};
		config = {
			enabled: true,
			lookbackDays: 3,
			maxSummariesPerRun: 20,
			dailyFeedEnabled: true,
			notifyEnabled: true,
			notifyMaxAgeDays: 3,
		};
	});

	it('does nothing while disabled', async () => {
		config.enabled = false;

		await makeScheduler().run();

		expect(service.scan).not.toHaveBeenCalled();
		expect(service.processPending).not.toHaveBeenCalled();
		expect(notifier.notifyProcessed).not.toHaveBeenCalled();
	});

	// TRA-261: o documento visto na rodada e avisado na mesma rodada.
	it('scans, processes, then notifies holders', async () => {
		const order: string[] = [];
		service.scan.mockImplementation(async () => {
			order.push('scan');
			return { tickers: 0, registered: 0, failedTickers: 0, dailyFeed: 'ok' };
		});
		service.processPending.mockImplementation(async () => {
			order.push('process');
			return { summarized: 0, skipped: 0, failed: 0 };
		});
		notifier.notifyProcessed.mockImplementation(async () => {
			order.push('notify');
			return { documents: 0, events: 0, skipped: 0, failed: 0 };
		});

		await makeScheduler().run();

		expect(order).toEqual(['scan', 'process', 'notify']);
	});

	it('still notifies what was processed before when processing fails', async () => {
		service.processPending.mockRejectedValue(new Error('ia fora'));

		await expect(makeScheduler().run()).resolves.toBeUndefined();

		expect(notifier.notifyProcessed).toHaveBeenCalled();
	});

	it('survives a failing notification step', async () => {
		notifier.notifyProcessed.mockRejectedValue(new Error('mongo fora'));

		await expect(makeScheduler().run()).resolves.toBeUndefined();
	});

	it('still processes the pending queue when the scan fails', async () => {
		service.scan.mockRejectedValue(new Error('cvm down'));

		await expect(makeScheduler().run()).resolves.toBeUndefined();

		expect(service.processPending).toHaveBeenCalled();
	});

	it('never overlaps two runs', async () => {
		let release!: () => void;
		service.scan.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = () =>
						resolve({
							tickers: 0,
							registered: 0,
							failedTickers: 0,
							dailyFeed: 'ok',
						});
				})
		);
		const scheduler = makeScheduler();

		const first = scheduler.run();
		await scheduler.run();
		release();
		await first;

		expect(service.scan).toHaveBeenCalledTimes(1);
	});
});
