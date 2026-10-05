import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { TrackerrIaAiEvalAdapter } from 'src/ai/evaluation/infrastructure/trackerr-ia-ai-eval.adapter';

describe('TrackerrIaAiEvalAdapter (TRA-242)', () => {
	let httpService: { post: jest.Mock };
	let adapter: TrackerrIaAiEvalAdapter;

	beforeEach(() => {
		httpService = { post: jest.fn() };
		adapter = new TrackerrIaAiEvalAdapter(
			httpService as unknown as HttpService
		);
	});

	const run = () =>
		adapter.run({
			items: [
				{
					id: 'a1',
					route: 'regex',
					intent: 'portfolio_summary',
					question: 'Quanto tenho?',
					answer: 'R$ 61.420,00.',
				},
			],
			windowDays: 7,
			maxRagSamples: 30,
		});

	it('sends the samples in the trackerr-ia schema with a long timeout', async () => {
		httpService.post.mockReturnValue(
			of({ data: { rubric_version: 'v1', by_route: {}, by_intent: {} } })
		);

		await run();

		const [url, body, config] = httpService.post.mock.calls[0];
		expect(url).toMatch(/\/api\/evals\/run$/);
		expect(body).toEqual({
			items: [
				{
					id: 'a1',
					route: 'regex',
					intent: 'portfolio_summary',
					question: 'Quanto tenho?',
					answer: 'R$ 61.420,00.',
				},
			],
			window_days: 7,
			max_rag_samples: 30,
		});
		expect(config.timeout).toBe(TrackerrIaAiEvalAdapter.TIMEOUT_MS);
	});

	it('fails on a response that is not a report', async () => {
		httpService.post.mockReturnValue(of({ data: { detail: 'erro' } }));

		await expect(run()).rejects.toThrow('ai_eval_unexpected_response');
	});
});
