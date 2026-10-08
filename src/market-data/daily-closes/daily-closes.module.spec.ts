import { Test } from '@nestjs/testing';
import { DailyClosesAdminController } from './admin/daily-closes-admin.controller';
import { AssetBetaService } from './application/asset-beta.service';
import {
	DAILY_CLOSES_CONFIG,
	DAILY_CLOSES_DEFAULTS,
} from './application/daily-closes.config';
import { DailyClosesIngestService } from './application/daily-closes-ingest.service';
import { DailyClosesJobService } from './application/daily-closes-job.service';
import { DailyClosesScheduler } from './application/daily-closes.scheduler';
import {
	ASSET_BETA_WRITER,
	COTAHIST_SOURCE,
	DAILY_CLOSE_STORE,
	HELD_SYMBOLS_READER,
} from './application/ports';

/**
 * Fiação do módulo sem o Mongo: os tokens de porta que cada serviço injeta
 * precisam bater com os que o módulo registra, ou o app não sobe.
 */
describe('DailyClosesModule — fiação (TRA-251)', () => {
	async function compile(enabled: boolean) {
		const store = {
			count: jest.fn().mockResolvedValue(0),
			latestDate: jest.fn().mockResolvedValue(null),
		};
		const moduleRef = await Test.createTestingModule({
			controllers: [DailyClosesAdminController],
			providers: [
				{
					provide: DAILY_CLOSES_CONFIG,
					useValue: { ...DAILY_CLOSES_DEFAULTS, enabled },
				},
				{ provide: DAILY_CLOSE_STORE, useValue: store },
				{ provide: COTAHIST_SOURCE, useValue: {} },
				{ provide: HELD_SYMBOLS_READER, useValue: { list: async () => [] } },
				{ provide: ASSET_BETA_WRITER, useValue: {} },
				DailyClosesIngestService,
				AssetBetaService,
				DailyClosesJobService,
				DailyClosesScheduler,
			],
		}).compile();
		return moduleRef;
	}

	it('resolve o controller admin, o job e o relógio', async () => {
		const moduleRef = await compile(false);

		expect(moduleRef.get(DailyClosesAdminController)).toBeDefined();
		expect(moduleRef.get(DailyClosesJobService)).toBeDefined();
		expect(moduleRef.get(DailyClosesScheduler)).toBeDefined();
	});

	it('desligado por padrão: o relógio das 22h não roda nada', async () => {
		const moduleRef = await compile(false);
		const job = moduleRef.get(DailyClosesJobService);
		const spy = jest.spyOn(job, 'run');

		await moduleRef.get(DailyClosesScheduler).run();

		expect(spy).not.toHaveBeenCalled();
	});

	it('ligado, o relógio dispara a rodada', async () => {
		const moduleRef = await compile(true);
		const job = moduleRef.get(DailyClosesJobService);
		const spy = jest.spyOn(job, 'run').mockResolvedValue(null);

		await moduleRef.get(DailyClosesScheduler).run();

		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('o "rodar agora" responde na hora e recusa rodada em andamento', async () => {
		const moduleRef = await compile(false);
		const controller = moduleRef.get(DailyClosesAdminController);
		const job = moduleRef.get(DailyClosesJobService);
		jest.spyOn(job, 'run').mockResolvedValue(null);

		expect(controller.run({ user: { userId: 'admin-1' } })).toEqual({
			status: 'started',
		});

		jest.spyOn(job, 'isRunning', 'get').mockReturnValue(true);
		expect(controller.run({})).toEqual({ status: 'already_running' });
	});
});
