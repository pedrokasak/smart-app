import z from 'zod';

/**
 * Histórico diário de preços via COTAHIST (TRA-251). Desligado por padrão:
 * baixa arquivos da B3 e grava no Mongo. Liga com
 * `DAILY_CLOSES_INGEST_ENABLED=true`; o "rodar agora" do admin funciona sem
 * ela, para validar a fonte antes de ligar o relógio.
 */
export interface DailyClosesConfig {
	enabled: boolean;
	baseUrl: string;
	/** Dias úteis para trás que o job diário confere (cobre atraso e queda). */
	catchUpDays: number;
	/** Quantos anos para trás vale buscar histórico de uma posição. */
	backfillYears: number;
	/** Arquivos anuais por rodada: cada um tem dezenas de MB. */
	maxYearsPerRun: number;
	/** Ativo usado como mercado no beta (o IBOV não está no COTAHIST). */
	marketProxy: string;
}

export const DAILY_CLOSES_CONFIG = Symbol('DAILY_CLOSES_CONFIG');

export const DAILY_CLOSES_DEFAULTS: DailyClosesConfig = {
	enabled: false,
	baseUrl: 'https://bvmf.bmfbovespa.com.br/InstDados/SerHist',
	catchUpDays: 7,
	backfillYears: 6,
	maxYearsPerRun: 2,
	marketProxy: 'BOVA11',
};

function field<T>(parser: z.ZodType<T>, value: unknown): T | undefined {
	if (value === undefined || value === '') return undefined;
	const parsed = parser.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}

export function loadDailyClosesConfig(
	env: NodeJS.ProcessEnv = process.env
): DailyClosesConfig {
	return {
		enabled: env.DAILY_CLOSES_INGEST_ENABLED === 'true',
		baseUrl:
			field(z.string().url(), env.COTAHIST_BASE_URL)?.replace(/\/+$/, '') ??
			DAILY_CLOSES_DEFAULTS.baseUrl,
		catchUpDays:
			field(
				z.coerce.number().int().min(1).max(30),
				env.COTAHIST_CATCH_UP_DAYS
			) ?? DAILY_CLOSES_DEFAULTS.catchUpDays,
		backfillYears:
			field(
				z.coerce.number().int().min(1).max(20),
				env.COTAHIST_BACKFILL_YEARS
			) ?? DAILY_CLOSES_DEFAULTS.backfillYears,
		maxYearsPerRun:
			field(
				z.coerce.number().int().min(1).max(5),
				env.COTAHIST_MAX_YEARS_PER_RUN
			) ?? DAILY_CLOSES_DEFAULTS.maxYearsPerRun,
		marketProxy: DAILY_CLOSES_DEFAULTS.marketProxy,
	};
}
