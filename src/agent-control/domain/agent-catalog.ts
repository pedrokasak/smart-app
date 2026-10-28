import z from 'zod';
import { AgentDefinition, AgentScheduleOption } from './agent-definition';
import { envIsTrue, envKills } from './env-switch';

/**
 * Catálogo dos agentes (ADR-005, seção 3).
 *
 * Um arquivo só, sem importar os módulos dos agentes: o registro sabe o id,
 * o nome e a variável de cada um, e cada agendador consulta a porta pelo id.
 * Assim o controle não cria dependência dos 18 módulos, e um agente novo
 * (ADR-004) entra no painel com uma linha aqui.
 *
 * Variáveis: os agentes que já tinham interruptor no ambiente mantêm o nome
 * (`RI_WATCH_ENABLED`, `AI_EVAL_ENABLED`...), agora só como kill switch. Os
 * que estavam sempre ligados ganham `AGENT_<ID>_ENABLED`, que também só
 * desliga.
 */
const SAO_PAULO = 'America/Sao_Paulo';

function agentEnvName(id: string): string {
	return `AGENT_${id.toUpperCase().replace(/-/g, '_')}_ENABLED`;
}

function scheduleSchema(options: AgentScheduleOption[]) {
	const ids = options.map((option) => option.id) as [string, ...string[]];
	return z.enum(ids);
}

/** Sempre ligado até hoje: semeia ligado, salvo kill switch já escrito no ambiente. */
function alwaysOnSeed(envName: string) {
	return (env: NodeJS.ProcessEnv) => !envKills(env[envName]);
}

/** Ligava só com "true" no ambiente: semeia esse mesmo valor. */
function optInSeed(envName: string) {
	return (env: NodeJS.ProcessEnv) => envIsTrue(env[envName]);
}

const RAG_INGESTION_SCHEDULES: AgentScheduleOption[] = [
	{ id: '02h00', label: '02h00', cron: '0 2 * * *' },
	{ id: '03h00', label: '03h00', cron: '0 3 * * *' },
	{ id: '04h00', label: '04h00', cron: '0 4 * * *' },
];

const AI_EVAL_SCHEDULES: AgentScheduleOption[] = [
	{ id: 'seg-06h00', label: 'segunda, 06h00', cron: '0 6 * * 1' },
	{ id: 'seg-07h00', label: 'segunda, 07h00', cron: '0 7 * * 1' },
	{ id: 'seg-08h00', label: 'segunda, 08h00', cron: '0 8 * * 1' },
];

const DAILY_CLOSES_SCHEDULES: AgentScheduleOption[] = [
	{ id: '21h00', label: '21h00, dias úteis', cron: '0 21 * * 1-5' },
	{ id: '22h00', label: '22h00, dias úteis', cron: '0 22 * * 1-5' },
	{ id: '23h00', label: '23h00, dias úteis', cron: '0 23 * * 1-5' },
];

function toggleable(
	definition: Omit<
		AgentDefinition,
		'criticality' | 'envKillSwitch' | 'seedEnabled'
	> & {
		envKillSwitch?: string;
		/** Ligava só com "true" (padrão: estava sempre ligado). */
		optIn?: boolean;
	}
): AgentDefinition {
	const { optIn, ...rest } = definition;
	const envKillSwitch = definition.envKillSwitch ?? agentEnvName(definition.id);
	return {
		...rest,
		criticality: 'toggleable',
		envKillSwitch,
		seedEnabled: optIn ? optInSeed(envKillSwitch) : alwaysOnSeed(envKillSwitch),
	};
}

function locked(
	definition: Pick<AgentDefinition, 'id' | 'name' | 'schedule'>
): AgentDefinition {
	return {
		...definition,
		kind: 'data_job',
		criticality: 'locked',
		defaultEnabled: true,
		seedEnabled: () => true,
	};
}

export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
	// --- IA ---
	toggleable({
		id: 'ri-watch',
		name: 'Vigia de RI',
		kind: 'ai_agent',
		schedule: '07h, 12h e 18h',
		defaultEnabled: false,
		envKillSwitch: 'RI_WATCH_ENABLED',
		optIn: true,
		detailRoute: '/admin/ri-watch',
		// As quatro etapas (TRA-260/261/264/266). As variáveis delas continuam
		// valendo como kill switch de cada etapa: ver `ri-watch.config.ts`.
		configSchema: z
			.object({
				enet: z.boolean(),
				fii: z.boolean(),
				notify: z.boolean(),
				index: z.boolean(),
			})
			.strict(),
		seedConfig: (env) => ({
			enet: !envKills(env.RI_WATCH_ENET_ENABLED),
			fii: envIsTrue(env.RI_WATCH_FII_ENABLED),
			notify: envIsTrue(env.RI_WATCH_NOTIFY_ENABLED),
			index: envIsTrue(env.RI_WATCH_INDEX_ENABLED),
		}),
	}),
	toggleable({
		id: 'ai-eval',
		name: 'Avaliação da IA',
		kind: 'ai_agent',
		schedule: 'segunda, 06h00',
		defaultEnabled: false,
		envKillSwitch: 'AI_EVAL_ENABLED',
		optIn: true,
		detailRoute: '/admin/ai-eval',
		scheduleOptions: AI_EVAL_SCHEDULES,
		cronName: 'ai-eval',
		timeZone: SAO_PAULO,
		configSchema: z
			.object({ schedule: scheduleSchema(AI_EVAL_SCHEDULES) })
			.strict(),
		seedConfig: () => ({ schedule: 'seg-06h00' }),
	}),
	toggleable({
		id: 'rag-ingestion',
		name: 'Ingestão de fatos no RAG',
		kind: 'ai_agent',
		schedule: '03h00',
		defaultEnabled: false,
		scheduleOptions: RAG_INGESTION_SCHEDULES,
		cronName: 'rag-ingestion',
		timeZone: SAO_PAULO,
		configSchema: z
			.object({ schedule: scheduleSchema(RAG_INGESTION_SCHEDULES) })
			.strict(),
		seedConfig: () => ({ schedule: '03h00' }),
	}),
	toggleable({
		id: 'portfolio-digest',
		name: 'Resumo semanal',
		kind: 'ai_agent',
		schedule: 'segunda, 09h00',
		defaultEnabled: false,
		// O envio é compromisso com quem optou por receber; a narração por IA é
		// o que tem custo. Desligar só a narração mantém o e-mail determinístico.
		configSchema: z.object({ aiNarration: z.boolean() }).strict(),
		seedConfig: () => ({ aiNarration: true }),
	}),
	toggleable({
		id: 'notification-ai-summary',
		name: 'Resumo de avisos por IA',
		kind: 'ai_capability',
		schedule: 'sob demanda',
		defaultEnabled: false,
		envKillSwitch: 'NOTIFICATION_AI_SUMMARY_ENABLED',
	}),
	toggleable({
		id: 'chat-tool-router',
		name: 'Copiloto com ferramentas',
		kind: 'ai_capability',
		schedule: 'sob demanda',
		defaultEnabled: false,
		envKillSwitch: 'CHAT_TOOL_ROUTER_ENABLED',
		optIn: true,
	}),

	// --- Dados ---
	toggleable({
		id: 'daily-closes',
		name: 'Fechamentos da B3',
		kind: 'data_job',
		schedule: '22h00, dias úteis',
		defaultEnabled: false,
		envKillSwitch: 'DAILY_CLOSES_INGEST_ENABLED',
		optIn: true,
		scheduleOptions: DAILY_CLOSES_SCHEDULES,
		cronName: 'daily-closes',
		timeZone: SAO_PAULO,
		configSchema: z
			.object({ schedule: scheduleSchema(DAILY_CLOSES_SCHEDULES) })
			.strict(),
		seedConfig: () => ({ schedule: '22h00' }),
	}),
	toggleable({
		id: 'cohort-benchmark',
		name: 'Benchmark por coorte',
		kind: 'data_job',
		schedule: 'dia 1, 04h00',
		// Base legal (ADR-003): nunca liga sozinho.
		defaultEnabled: false,
		envKillSwitch: 'BENCHMARK_COHORT_JOB_ENABLED',
		optIn: true,
	}),
	toggleable({
		id: 'investor-profile',
		name: 'Perfil do investidor',
		kind: 'data_job',
		schedule: '04h00',
		defaultEnabled: true,
	}),
	toggleable({
		id: 'macro-series',
		name: 'Séries do BCB',
		kind: 'data_job',
		schedule: '10h30',
		defaultEnabled: true,
	}),
	toggleable({
		id: 'tesouro-offers',
		name: 'Ofertas do Tesouro',
		kind: 'data_job',
		schedule: '10h40 e 18h40',
		defaultEnabled: true,
	}),
	toggleable({
		id: 'fixed-income-marking',
		name: 'Marcação de renda fixa',
		kind: 'data_job',
		schedule: '11h00',
		defaultEnabled: true,
	}),
	toggleable({
		id: 'investment-funds',
		name: 'Cotas de fundos',
		kind: 'data_job',
		schedule: '06h50, 07h20 e 19h20',
		defaultEnabled: true,
	}),
	toggleable({
		id: 'quote-freshness',
		name: 'Frescor de cotações',
		kind: 'data_job',
		schedule: 'a cada 15 min e no pregão',
		defaultEnabled: true,
	}),
	toggleable({
		id: 'sector-backfill',
		name: 'Setores dos ativos',
		kind: 'data_job',
		schedule: '05h00',
		defaultEnabled: true,
	}),
	toggleable({
		id: 'portfolio-evaluation',
		name: 'Avaliação de carteira e limiares',
		kind: 'data_job',
		schedule: '07h00',
		defaultEnabled: true,
	}),
	toggleable({
		id: 'daily-push-digest',
		name: 'Push diário',
		kind: 'data_job',
		schedule: '09h00',
		defaultEnabled: true,
	}),
	toggleable({
		id: 'report-delivery',
		name: 'Entrega de relatórios',
		kind: 'data_job',
		schedule: 'de hora em hora',
		defaultEnabled: true,
	}),

	// --- Críticos: na lista, sem interruptor ---
	locked({
		id: 'cleanup',
		name: 'Snapshots diários de carteira',
		schedule: '00h00 e 19h30',
	}),
	locked({
		id: 'subscription-expiry',
		name: 'Expiração de assinaturas',
		schedule: '02h00',
	}),
	locked({
		id: 'subscription-expiring',
		name: 'Aviso de assinatura vencendo',
		schedule: '08h00',
	}),
	locked({
		id: 'lgpd-erasure',
		name: 'Apagamento LGPD',
		schedule: 'sob demanda',
	}),
];

/** Motivo do cadeado, mostrado no painel. */
export const LOCK_REASONS: Record<string, string> = {
	cleanup:
		'O histórico de patrimônio depende dele; dia sem snapshot não volta.',
	'subscription-expiry': 'Cobrança e acesso aos planos pagos.',
	'subscription-expiring': 'Aviso ao cliente exigido pelo fluxo de assinatura.',
	'lgpd-erasure': 'Obrigação legal (LGPD).',
};

export function findAgentDefinition(id: string): AgentDefinition | undefined {
	return AGENT_DEFINITIONS.find((definition) => definition.id === id);
}
