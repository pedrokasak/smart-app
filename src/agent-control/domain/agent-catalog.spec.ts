import { CronTime } from 'cron';
import { AGENT_DEFINITIONS, findAgentDefinition } from './agent-catalog';

describe('AGENT_DEFINITIONS', () => {
	it('tem ids únicos', () => {
		const ids = AGENT_DEFINITIONS.map((definition) => definition.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('todo agente controlável tem kill switch no ambiente', () => {
		for (const definition of AGENT_DEFINITIONS) {
			if (definition.criticality === 'toggleable') {
				expect(definition.envKillSwitch).toBeTruthy();
			}
		}
	});

	it('agente de IA nasce desligado quando o banco não responde', () => {
		for (const definition of AGENT_DEFINITIONS) {
			if (definition.kind !== 'data_job') {
				expect(definition.defaultEnabled).toBe(false);
			}
		}
	});

	it('horários do painel são crons válidos e com nome de job', () => {
		for (const definition of AGENT_DEFINITIONS) {
			for (const option of definition.scheduleOptions ?? []) {
				expect(
					() => new CronTime(option.cron, definition.timeZone)
				).not.toThrow();
				expect(definition.cronName).toBeTruthy();
			}
		}
	});

	it('a configuração semeada passa no próprio esquema', () => {
		for (const definition of AGENT_DEFINITIONS) {
			if (!definition.configSchema) continue;
			const seed = definition.seedConfig?.({}) ?? {};
			expect(definition.configSchema.safeParse(seed).success).toBe(true);
		}
	});

	it('semeia o estado que o ambiente produz hoje', () => {
		const riWatch = findAgentDefinition('ri-watch')!;
		expect(riWatch.seedEnabled({})).toBe(false);
		expect(riWatch.seedEnabled({ RI_WATCH_ENABLED: 'true' })).toBe(true);

		const ragIngestion = findAgentDefinition('rag-ingestion')!;
		expect(ragIngestion.seedEnabled({})).toBe(true);
		expect(
			ragIngestion.seedEnabled({ AGENT_RAG_INGESTION_ENABLED: 'false' })
		).toBe(false);

		const summary = findAgentDefinition('notification-ai-summary')!;
		expect(summary.seedEnabled({})).toBe(true);
		expect(
			summary.seedEnabled({ NOTIFICATION_AI_SUMMARY_ENABLED: 'false' })
		).toBe(false);
	});

	it('semeia as etapas do vigia de RI a partir das variáveis de hoje', () => {
		const riWatch = findAgentDefinition('ri-watch')!;
		expect(riWatch.seedConfig!({})).toEqual({
			enet: true,
			fii: false,
			notify: false,
			index: false,
		});
		expect(
			riWatch.seedConfig!({
				RI_WATCH_ENET_ENABLED: 'false',
				RI_WATCH_NOTIFY_ENABLED: 'true',
			})
		).toEqual({ enet: false, fii: false, notify: true, index: false });
	});
});
