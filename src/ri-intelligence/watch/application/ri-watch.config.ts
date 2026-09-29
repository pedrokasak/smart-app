import z from 'zod';

/**
 * Configuracao do vigia de RI (TRA-240), lida do ambiente com schema proprio
 * — mesmo padrao de `thresholds.config.ts`.
 *
 * Desligado por padrao: a rotina baixa o dataset da CVM, os PDFs e chama a
 * IA. Liga-se no ambiente (`RI_WATCH_ENABLED=true`) depois de validado, sem
 * precisar de deploy para desligar.
 */
export interface RiWatchConfig {
	enabled: boolean;
	/**
	 * Janela da descoberta, em dias. O dataset IPE da CVM e SEMANAL (a propria
	 * CVM declara; o arquivo muda aos domingos, ~07h): um documento entregue
	 * na segunda so aparece no arquivo seguinte, ja com 6 dias. Janela menor
	 * que a semana perderia esse documento para sempre — por isso o minimo e 8.
	 */
	lookbackDays: number;
	/** Teto de resumos por execucao: e o limite de custo de IA da rotina. */
	maxSummariesPerRun: number;
	/**
	 * Consulta diaria do ENET (TRA-260). Ligada por padrao quando o vigia
	 * esta ligado; interruptor proprio para desligar so esta fonte (pedido da
	 * CVM, captcha ligado, mudanca de formato) sem parar o vigia inteiro.
	 */
	dailyFeedEnabled: boolean;
	/**
	 * Aviso a quem tem o papel (TRA-261). Desligado por padrao, com
	 * interruptor proprio: liga-se depois de ver a varredura e os resumos
	 * funcionando, e desliga-se sem parar o vigia.
	 */
	notifyEnabled: boolean;
	/**
	 * Idade maxima, em dias, de um documento para ainda virar aviso. Ao ligar
	 * o vigia ele registra os ultimos `lookbackDays` dias; sem este corte, a
	 * primeira rodada mandaria de uma vez os avisos de uma semana e meia.
	 */
	notifyMaxAgeDays: number;
}

export const RI_WATCH_CONFIG = Symbol('RI_WATCH_CONFIG');

export const RI_WATCH_DEFAULTS: RiWatchConfig = {
	enabled: false,
	lookbackDays: 10,
	maxSummariesPerRun: 20,
	dailyFeedEnabled: true,
	notifyEnabled: false,
	notifyMaxAgeDays: 3,
};

const enabledSchema = z.enum(['true', 'false']);
const lookbackDaysSchema = z.coerce.number().int().min(8).max(30);
const maxSummariesSchema = z.coerce.number().int().min(0).max(200);
const notifyMaxAgeSchema = z.coerce.number().int().min(1).max(7);

/**
 * Campo por campo: um valor invalido volta ao padrao sozinho, sem derrubar
 * os outros — um typo no teto de resumos nao pode religar a rotina.
 */
function field<T>(parser: z.ZodType<T>, value: unknown): T | undefined {
	if (value === undefined || value === '') return undefined;
	const parsed = parser.safeParse(value);
	return parsed.success ? parsed.data : undefined;
}

/**
 * Interruptor de desligamento de uma fonte externa: sem valor, fica ligado;
 * QUALQUER valor escrito que nao seja "true" desliga — "0", "False", "off".
 * Quem mexe nele quer parar de consultar a CVM, e a intencao nao pode se
 * perder num jeito diferente de escrever "desligado".
 */
function killSwitch(value: string | undefined): boolean {
	const normalized = String(value ?? '')
		.trim()
		.toLowerCase();
	return normalized === '' || normalized === 'true';
}

export function loadRiWatchConfig(
	env: NodeJS.ProcessEnv = process.env
): RiWatchConfig {
	return {
		enabled: field(enabledSchema, env.RI_WATCH_ENABLED) === 'true',
		lookbackDays:
			field(lookbackDaysSchema, env.RI_WATCH_LOOKBACK_DAYS) ??
			RI_WATCH_DEFAULTS.lookbackDays,
		maxSummariesPerRun:
			field(maxSummariesSchema, env.RI_WATCH_MAX_SUMMARIES_PER_RUN) ??
			RI_WATCH_DEFAULTS.maxSummariesPerRun,
		dailyFeedEnabled: killSwitch(env.RI_WATCH_ENET_ENABLED),
		notifyEnabled: field(enabledSchema, env.RI_WATCH_NOTIFY_ENABLED) === 'true',
		notifyMaxAgeDays:
			field(notifyMaxAgeSchema, env.RI_WATCH_NOTIFY_MAX_AGE_DAYS) ??
			RI_WATCH_DEFAULTS.notifyMaxAgeDays,
	};
}
