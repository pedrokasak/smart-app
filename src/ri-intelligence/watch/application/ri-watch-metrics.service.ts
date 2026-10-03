import { Inject, Injectable } from '@nestjs/common';
import z from 'zod';
import {
	RI_WATCH_METRICS_READER,
	RiWatchMetricsReader,
	RiWatchMetricsSnapshot,
} from './ports/ri-watch-metrics.port';
import { RI_WATCH_CONFIG, RiWatchConfig } from './ri-watch.config';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Janela do painel: o mes que passou. */
export const RI_WATCH_METRICS_WINDOW_DAYS = 30;

/**
 * Preco por mil tokens, em USD, para estimar o custo dos resumos (TRA-267).
 * Estimativa: o trackerr-ia escolhe o provedor numa cadeia com fallback, e o
 * server nao sabe qual respondeu. O padrao fica na faixa dos modelos rapidos
 * (entrada e saida somadas); ajusta-se no ambiente.
 */
export const RI_WATCH_COST_PER_1K_TOKENS = Symbol(
	'RI_WATCH_COST_PER_1K_TOKENS'
);
export const DEFAULT_COST_PER_1K_TOKENS_USD = 0.0005;

export function loadCostPer1kTokensUsd(
	env: NodeJS.ProcessEnv = process.env
): number {
	const parsed = z.coerce
		.number()
		.min(0)
		.max(1)
		.safeParse(env.RI_WATCH_COST_PER_1K_TOKENS_USD);
	return env.RI_WATCH_COST_PER_1K_TOKENS_USD && parsed.success
		? parsed.data
		: DEFAULT_COST_PER_1K_TOKENS_USD;
}

export interface RiWatchMetricsOverview extends RiWatchMetricsSnapshot {
	generatedAt: string;
	windowDays: number;
	/** O que esta ligado: sem isto, fila parada parece defeito. */
	switches: {
		enabled: boolean;
		dailyFeed: boolean;
		fii: boolean;
		notify: boolean;
		index: boolean;
		maxSummariesPerRun: number;
	};
	cost: {
		aiCalls: number;
		tokens: number;
		estimatedUsd: number;
		pricePer1kTokensUsd: number;
	};
}

/** Painel admin do vigia de RI (TRA-240, aceite; TRA-267). */
@Injectable()
export class RiWatchMetricsService {
	constructor(
		@Inject(RI_WATCH_METRICS_READER)
		private readonly reader: RiWatchMetricsReader,
		@Inject(RI_WATCH_CONFIG) private readonly config: RiWatchConfig,
		@Inject(RI_WATCH_COST_PER_1K_TOKENS)
		private readonly pricePer1kTokensUsd: number
	) {}

	async overview(now: Date = new Date()): Promise<RiWatchMetricsOverview> {
		const since = new Date(
			now.getTime() - RI_WATCH_METRICS_WINDOW_DAYS * DAY_MS
		);
		const snapshot = await this.reader.read(since);
		return {
			generatedAt: now.toISOString(),
			windowDays: RI_WATCH_METRICS_WINDOW_DAYS,
			switches: {
				enabled: this.config.enabled,
				dailyFeed: this.config.dailyFeedEnabled,
				fii: this.config.fiiEnabled,
				notify: this.config.notifyEnabled,
				index: this.config.indexEnabled,
				maxSummariesPerRun: this.config.maxSummariesPerRun,
			},
			...snapshot,
			cost: {
				...snapshot.usage,
				estimatedUsd: Number(
					((snapshot.usage.tokens / 1000) * this.pricePer1kTokensUsd).toFixed(4)
				),
				pricePer1kTokensUsd: this.pricePer1kTokensUsd,
			},
		};
	}
}
