import { Inject, Injectable, Logger } from '@nestjs/common';
import { AssetBetaService } from './asset-beta.service';
import { DAILY_CLOSES_CONFIG, DailyClosesConfig } from './daily-closes.config';
import {
	DailyClosesIngestService,
	IngestReport,
} from './daily-closes-ingest.service';
import { DAILY_CLOSE_STORE, DailyCloseStore } from './ports';

export interface DailyClosesOverview {
	/** O relógio noturno está ligado; o "rodar agora" funciona sem ele. */
	scheduled: boolean;
	running: boolean;
	rows: number;
	latestDate: string | null;
	lastRun: JobRun | null;
}

export interface JobRun {
	startedAt: string;
	finishedAt: string | null;
	report: (IngestReport & { betasUpdated: number }) | null;
	error: string | null;
}

/**
 * Uma rodada completa: baixa o que falta e recalcula os betas. Uma só por
 * vez — o relógio e o "rodar agora" do admin não se atropelam, e o arquivo
 * anual é pesado demais para dois processarem juntos.
 */
@Injectable()
export class DailyClosesJobService {
	private readonly logger = new Logger(DailyClosesJobService.name);
	private running = false;
	private last: JobRun | null = null;

	constructor(
		private readonly ingest: DailyClosesIngestService,
		private readonly betas: AssetBetaService,
		@Inject(DAILY_CLOSE_STORE) private readonly store: DailyCloseStore,
		@Inject(DAILY_CLOSES_CONFIG) private readonly config: DailyClosesConfig
	) {}

	get isRunning(): boolean {
		return this.running;
	}

	async overview(): Promise<DailyClosesOverview> {
		const [rows, latestDate] = await Promise.all([
			this.store.count(),
			this.store.latestDate(),
		]);
		return {
			scheduled: this.config.enabled,
			running: this.running,
			rows,
			latestDate,
			lastRun: this.last,
		};
	}

	async run(now: Date = new Date()): Promise<JobRun | null> {
		if (this.running) return null;
		this.running = true;
		const run: JobRun = {
			startedAt: now.toISOString(),
			finishedAt: null,
			report: null,
			error: null,
		};
		try {
			const report = await this.ingest.run(now);
			run.report = { ...report, betasUpdated: await this.betas.refresh(now) };
		} catch (error) {
			run.error = error instanceof Error ? error.message : String(error);
			this.logger.error(`Histórico diário falhou: ${run.error}`);
		} finally {
			run.finishedAt = new Date().toISOString();
			this.last = run;
			this.running = false;
		}
		return run;
	}
}
