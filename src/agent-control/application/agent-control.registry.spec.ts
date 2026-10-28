import {
	AGENT_CONTROL_CACHE_TTL_MS,
	AgentControlRegistry,
} from './agent-control.registry';
import { InMemoryAgentControlStore } from './in-memory-agent-control.store.fixture';

describe('AgentControlRegistry', () => {
	let now: Date;
	let store: InMemoryAgentControlStore;
	let applied: { id: string; cron: string }[];

	function registry(env: NodeJS.ProcessEnv = {}) {
		return new AgentControlRegistry(
			store,
			{
				apply: (definition, cron) => applied.push({ id: definition.id, cron }),
			},
			env,
			() => now
		);
	}

	beforeEach(() => {
		now = new Date('2026-10-27T12:00:00Z');
		store = new InMemoryAgentControlStore();
		applied = [];
	});

	it('semeia com o que o ambiente produz hoje, sem tocar em crítico', async () => {
		const subject = registry({ RI_WATCH_ENABLED: 'true' });
		await subject.seed();

		expect(store.controls.get('ri-watch')?.enabled).toBe(true);
		expect(store.controls.get('ai-eval')?.enabled).toBe(false);
		expect(store.controls.get('rag-ingestion')?.enabled).toBe(true);
		expect(store.controls.has('cleanup')).toBe(false);
	});

	it('seed não sobrescreve o que o painel já gravou', async () => {
		const subject = registry({ RI_WATCH_ENABLED: 'true' });
		await subject.seed();
		store.controls.get('ri-watch')!.enabled = false;

		await subject.seed();

		expect(store.controls.get('ri-watch')?.enabled).toBe(false);
	});

	it('responde pelo estado efetivo, com o kill switch do ambiente por cima', async () => {
		const subject = registry({ AGENT_MACRO_SERIES_ENABLED: 'false' });
		await subject.seed();

		await expect(subject.isEnabled('rag-ingestion')).resolves.toBe(true);
		await expect(subject.isEnabled('macro-series')).resolves.toBe(false);
		await expect(subject.isEnabled('cleanup')).resolves.toBe(true);
	});

	it('guarda o estado por 30 s e recarrega depois', async () => {
		const subject = registry();
		await subject.seed();
		await expect(subject.isEnabled('rag-ingestion')).resolves.toBe(true);

		store.controls.get('rag-ingestion')!.enabled = false;
		await expect(subject.isEnabled('rag-ingestion')).resolves.toBe(true);

		now = new Date(now.getTime() + AGENT_CONTROL_CACHE_TTL_MS);
		await expect(subject.isEnabled('rag-ingestion')).resolves.toBe(false);
	});

	it('banco fora mantém o último estado carregado', async () => {
		const subject = registry();
		await subject.seed();
		await subject.refresh();

		store.failReads = true;
		now = new Date(now.getTime() + AGENT_CONTROL_CACHE_TTL_MS);

		await expect(subject.isEnabled('rag-ingestion')).resolves.toBe(true);
	});

	it('banco fora desde o boot: agente de IA fica desligado, job de dados segue', async () => {
		store.failReads = true;
		const subject = registry();

		await expect(subject.isEnabled('rag-ingestion')).resolves.toBe(false);
		await expect(subject.isEnabled('macro-series')).resolves.toBe(true);
	});

	it('peekEnabled é null antes do primeiro carregamento', async () => {
		const subject = registry();
		expect(subject.peekEnabled('ai-eval')).toBeNull();

		await subject.seed();
		await subject.refresh();

		expect(subject.peekEnabled('ai-eval')).toBe(false);
	});

	it('aplica o horário escolhido no painel uma vez por mudança', async () => {
		const subject = registry();
		await subject.seed();
		store.controls.get('rag-ingestion')!.config = { schedule: '02h00' };

		await subject.refresh();
		await subject.refresh();

		expect(applied).toEqual(
			expect.arrayContaining([{ id: 'rag-ingestion', cron: '0 2 * * *' }])
		);
		expect(applied.filter((item) => item.id === 'rag-ingestion')).toHaveLength(
			1
		);
	});

	it('recarga pedida durante outra em andamento lê o estado novo', async () => {
		const subject = registry();
		await subject.seed();
		await subject.refresh();
		now = new Date(now.getTime() + AGENT_CONTROL_CACHE_TTL_MS);

		const inFlight = subject.refresh();
		store.controls.get('rag-ingestion')!.enabled = false;
		await subject.refresh();
		await inFlight;

		await expect(subject.isEnabled('rag-ingestion')).resolves.toBe(false);
	});

	it('seed segue para os outros agentes quando um falha', async () => {
		const original = store.insertIfMissing.bind(store);
		store.insertIfMissing = async (control) => {
			if (control.agentId === 'ri-watch') throw new Error('E11000');
			return original(control);
		};

		await registry().seed();

		expect(store.controls.has('ri-watch')).toBe(false);
		expect(store.controls.has('report-delivery')).toBe(true);
	});

	it('id desconhecido é erro alto, não agente liberado', async () => {
		await expect(registry().isEnabled('ri-wacth')).rejects.toThrow(
			'Agente desconhecido'
		);
	});
});
