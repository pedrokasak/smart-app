import { RiWatchFiiScanner } from 'src/ri-intelligence/watch/application/ri-watch-fii.scanner';
import { RiWatchConfig } from 'src/ri-intelligence/watch/application/ri-watch.config';
import { RiWatchIndexer } from 'src/ri-intelligence/watch/application/ri-watch.indexer';
import { RiWatchNotifier } from 'src/ri-intelligence/watch/application/ri-watch.notifier';
import { RiWatchScheduler } from 'src/ri-intelligence/watch/application/ri-watch.scheduler';
import { RiWatchService } from 'src/ri-intelligence/watch/application/ri-watch.service';

const FII_RESULT = {
	status: 'ok',
	tickers: 1,
	unresolved: 0,
	failedFunds: 0,
	registered: 1,
};

describe('RiWatchScheduler (TRA-240)', () => {
	let service: { scan: jest.Mock; processPending: jest.Mock };
	let fiiScanner: { scan: jest.Mock };
	let notifier: { notifyProcessed: jest.Mock };
	let indexer: { indexProcessed: jest.Mock };
	let config: RiWatchConfig;

	const makeScheduler = () =>
		new RiWatchScheduler(
			service as unknown as RiWatchService,
			fiiScanner as unknown as RiWatchFiiScanner,
			notifier as unknown as RiWatchNotifier,
			indexer as unknown as RiWatchIndexer,
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
		fiiScanner = { scan: jest.fn().mockResolvedValue(FII_RESULT) };
		notifier = {
			notifyProcessed: jest
				.fn()
				.mockResolvedValue({ documents: 1, events: 3, skipped: 0, failed: 0 }),
		};
		indexer = {
			indexProcessed: jest
				.fn()
				.mockResolvedValue({ documents: 1, indexed: 1, failed: 0 }),
		};
		config = {
			enabled: true,
			lookbackDays: 3,
			maxSummariesPerRun: 20,
			dailyFeedEnabled: true,
			notifyEnabled: true,
			notifyMaxAgeDays: 3,
			indexEnabled: false,
			fiiEnabled: true,
		};
	});

	it('does nothing while disabled', async () => {
		config.enabled = false;

		await makeScheduler().run();

		expect(service.scan).not.toHaveBeenCalled();
		expect(fiiScanner.scan).not.toHaveBeenCalled();
		expect(service.processPending).not.toHaveBeenCalled();
		expect(notifier.notifyProcessed).not.toHaveBeenCalled();
	});

	// TRA-261: o documento visto na rodada e avisado na mesma rodada.
	it('scans stocks and FIIs, processes, then notifies holders', async () => {
		const order: string[] = [];
		service.scan.mockImplementation(async () => {
			order.push('scan');
			return { tickers: 0, registered: 0, failedTickers: 0, dailyFeed: 'ok' };
		});
		fiiScanner.scan.mockImplementation(async () => {
			order.push('scan-fii');
			return FII_RESULT;
		});
		service.processPending.mockImplementation(async () => {
			order.push('process');
			return { summarized: 0, skipped: 0, failed: 0 };
		});
		notifier.notifyProcessed.mockImplementation(async () => {
			order.push('notify');
			return { documents: 0, events: 0, skipped: 0, failed: 0 };
		});
		indexer.indexProcessed.mockImplementation(async () => {
			order.push('index');
			return { documents: 0, indexed: 0, failed: 0 };
		});

		await makeScheduler().run();

		// TRA-266: o FII visto na rodada e resumido na mesma rodada.
		// TRA-264: o acervo por ultimo — embedar um DFP leva minutos, e o
		// aviso nao espera por isso.
		expect(order).toEqual(['scan', 'scan-fii', 'process', 'notify', 'index']);
	});

	// TRA-266: FundosNet ou cadastro da CVM fora nao para as acoes.
	it('still processes when the FII scan fails', async () => {
		fiiScanner.scan.mockRejectedValue(new Error('mongo fora'));

		await expect(makeScheduler().run()).resolves.toBeUndefined();

		expect(service.processPending).toHaveBeenCalled();
	});

	it('still scans FIIs when the stock scan fails', async () => {
		service.scan.mockRejectedValue(new Error('cvm down'));

		await makeScheduler().run();

		expect(fiiScanner.scan).toHaveBeenCalled();
	});

	it('still indexes when notifying fails', async () => {
		notifier.notifyProcessed.mockRejectedValue(new Error('fila fora'));

		await expect(makeScheduler().run()).resolves.toBeUndefined();

		expect(indexer.indexProcessed).toHaveBeenCalled();
	});

	it('survives a failing index step', async () => {
		indexer.indexProcessed.mockRejectedValue(new Error('trackerr-ia fora'));

		await expect(makeScheduler().run()).resolves.toBeUndefined();
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
