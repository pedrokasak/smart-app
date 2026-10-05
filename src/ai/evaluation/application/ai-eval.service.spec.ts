import {
	AiEvalReportStore,
	StoredAiEvalReport,
} from 'src/ai/evaluation/application/ai-eval-report-store.port';
import {
	AiEvalRunnerPort,
	AiEvalRunReport,
} from 'src/ai/evaluation/application/ai-eval-runner.port';
import { AiEvalSampleSource } from 'src/ai/evaluation/application/ai-eval-sample-source.port';
import { AI_EVAL_DEFAULTS } from 'src/ai/evaluation/application/ai-eval.config';
import { AiEvalService } from 'src/ai/evaluation/application/ai-eval.service';

const NOW = new Date('2026-10-05T09:00:00.000Z');

const REPORT: AiEvalRunReport = {
	rubric_version: '2026-10-v1',
	judge_provider: 'gemini',
	prompt_fingerprint: 'abc',
	totals: { evaluated: 3 },
	by_route: {},
	by_intent: {},
	guard: {},
};

describe('AiEvalService (TRA-242)', () => {
	let source: jest.Mocked<AiEvalSampleSource>;
	let runner: jest.Mocked<AiEvalRunnerPort>;
	let store: jest.Mocked<AiEvalReportStore>;

	const makeService = () =>
		new AiEvalService(source, runner, store, {
			...AI_EVAL_DEFAULTS,
			enabled: true,
		});

	beforeEach(() => {
		source = {
			sampleChatAnswers: jest.fn().mockResolvedValue([
				{
					id: 'a1',
					intent: 'portfolio_risk',
					routingMode: 'tool_calling',
					question: 'Sou a Ana, cpf 123.456.789-09. Estou exposta demais?',
					answer: 'Sua carteira apresenta um Score de Risco de 64/100.',
				},
			]),
		};
		runner = { run: jest.fn().mockResolvedValue(REPORT) };
		store = {
			latest: jest.fn().mockResolvedValue(null),
			save: jest.fn().mockResolvedValue(undefined),
			prune: jest.fn().mockResolvedValue(undefined),
		};
	});

	it('samples the last week, scrubs personal data and sends no user id', async () => {
		await makeService().run(NOW);

		const [since, limit] = source.sampleChatAnswers.mock.calls[0];
		expect(NOW.getTime() - since.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
		expect(limit).toBe(AI_EVAL_DEFAULTS.chatSamples);
		const { items, windowDays, maxRagSamples } = runner.run.mock.calls[0][0];
		expect(items).toEqual([
			{
				id: 'a1',
				route: 'tool_calling',
				intent: 'portfolio_risk',
				question: 'Sou a Ana, cpf [CPF]. Estou exposta demais?',
				answer: 'Sua carteira apresenta um Score de Risco de 64/100.',
			},
		]);
		expect(windowDays).toBe(7);
		expect(maxRagSamples).toBe(AI_EVAL_DEFAULTS.ragSamples);
	});

	it('stores the aggregated report with regressions and keeps only the latest', async () => {
		const previous: StoredAiEvalReport = {
			createdAt: '2026-09-28T09:00:00.000Z',
			windowDays: 7,
			chatSamples: 50,
			report: {
				...REPORT,
				by_route: {
					rag: {
						count: 10,
						judged: 10,
						fidelity: 0.95,
						numeric_hallucination_rate: 0,
						recommendation_rate: 0,
						usefulness: 0.9,
						level_fit: 0.9,
						disclaimer_rate: 1,
					},
				},
			},
			regressions: [],
		};
		store.latest.mockResolvedValue(previous);
		runner.run.mockResolvedValue({
			...REPORT,
			by_route: {
				rag: { ...previous.report.by_route.rag, fidelity: 0.7 },
			},
		});

		const stored = await makeService().run(NOW);

		expect(stored?.regressions).toEqual([
			{
				scope: 'route',
				key: 'rag',
				metric: 'fidelity',
				previous: 0.95,
				current: 0.7,
			},
		]);
		expect(store.save).toHaveBeenCalledWith(
			expect.objectContaining({ createdAt: NOW.toISOString(), chatSamples: 1 })
		);
		expect(store.prune).toHaveBeenCalledWith(AI_EVAL_DEFAULTS.keepReports);
	});

	// O trackerr-ia recusa o lote inteiro se um texto passar do schema.
	it('cuts texts to the trackerr-ia limits', async () => {
		source.sampleChatAnswers.mockResolvedValue([
			{
				id: 'a1',
				intent: 'portfolio_summary',
				routingMode: 'regex',
				question: 'q'.repeat(2500),
				answer: 'a'.repeat(7000),
			},
		]);

		await makeService().run(NOW);

		const [item] = runner.run.mock.calls[0][0].items;
		expect(item.question).toHaveLength(2000);
		expect(item.answer).toHaveLength(6000);
	});

	it('never runs twice at the same time', async () => {
		let release!: (report: AiEvalRunReport) => void;
		runner.run.mockReturnValue(new Promise((resolve) => (release = resolve)));
		const service = makeService();

		const first = service.run(NOW);
		await new Promise((resolve) => setImmediate(resolve));
		expect(service.isRunning).toBe(true);
		await expect(service.run(NOW)).resolves.toBeNull();
		release(REPORT);
		await first;

		expect(runner.run).toHaveBeenCalledTimes(1);
		expect(service.isRunning).toBe(false);
	});

	it('frees the lock when the run fails', async () => {
		runner.run.mockRejectedValue(new Error('trackerr-ia fora'));
		const service = makeService();

		await expect(service.run(NOW)).rejects.toThrow('trackerr-ia fora');

		expect(service.isRunning).toBe(false);
		expect(store.save).not.toHaveBeenCalled();
	});
});
