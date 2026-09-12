import { of, throwError } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { TrackerrIaRagSynthesizerAdapter } from 'src/ai/orchestration/infrastructure/trackerr-ia-rag-synthesizer.adapter';
import {
	UserPlanResolverPort,
	UserPlanTier,
} from 'src/subscription/application/user-plan.types';
import { ChatNarrativeSynthesisInput } from 'src/ai/orchestration/chat-narrative-synthesizer.port';

function makeInput(
	over: Partial<ChatNarrativeSynthesisInput> = {}
): ChatNarrativeSynthesisInput {
	return {
		userId: 'user-1',
		intent: 'narrative_synthesis',
		question: 'Por que minha carteira está concentrada?',
		facts: null,
		externalData: null,
		estimates: null,
		limitations: { unavailable: [], warnings: [], assumptions: [] },
		...over,
	};
}

describe('TrackerrIaRagSynthesizerAdapter (TRA-76)', () => {
	let httpService: { post: jest.Mock };
	let planResolver: { resolve: jest.Mock };
	let adapter: TrackerrIaRagSynthesizerAdapter;

	const withPlan = (tier: UserPlanTier) => {
		planResolver.resolve.mockResolvedValue(tier);
	};

	beforeEach(() => {
		httpService = { post: jest.fn() };
		planResolver = { resolve: jest.fn().mockResolvedValue('pro') };
		adapter = new TrackerrIaRagSynthesizerAdapter(
			httpService as unknown as HttpService,
			planResolver as unknown as UserPlanResolverPort
		);
	});

	it('returns the RAG answer when the plan qualifies and RAG has context', async () => {
		withPlan('pro');
		httpService.post.mockReturnValue(
			of({
				data: {
					answer: 'Sua carteira está concentrada porque...',
					source: 'ai',
					chunk_count: 3,
				},
			})
		);

		const out = await adapter.synthesize(makeInput());

		expect(out.text).toContain('concentrada');
		const [url, body] = httpService.post.mock.calls[0];
		expect(url).toContain('/api/rag/query');
		expect(body).toEqual({
			user_id: 'user-1',
			question: 'Por que minha carteira está concentrada?',
		});
	});

	it('does NOT call RAG for a free plan — pure cost with no access', async () => {
		withPlan('free');

		const out = await adapter.synthesize(makeInput());

		expect(out.text).toBe('');
		expect(httpService.post).not.toHaveBeenCalled();
	});

	it('allows premium and global_investor, not just pro', async () => {
		httpService.post.mockReturnValue(
			of({ data: { answer: 'resposta', source: 'ai', chunk_count: 1 } })
		);
		for (const tier of [
			'pro',
			'premium',
			'global_investor',
		] as UserPlanTier[]) {
			httpService.post.mockClear();
			withPlan(tier);
			await adapter.synthesize(makeInput());
			expect(httpService.post).toHaveBeenCalledTimes(1);
		}
	});

	it('falls back to empty when RAG has no context for the user', async () => {
		withPlan('pro');
		httpService.post.mockReturnValue(
			of({ data: { answer: '', source: 'no_context', chunk_count: 0 } })
		);

		const out = await adapter.synthesize(makeInput());

		expect(out.text).toBe('');
	});

	it('falls back to empty when the guard rejected the RAG answer', async () => {
		withPlan('pro');
		httpService.post.mockReturnValue(
			of({
				data: { answer: 'bloqueado', source: 'guard_rejected', chunk_count: 2 },
			})
		);

		const out = await adapter.synthesize(makeInput());

		expect(out.text).toBe('');
	});

	it('never throws to the caller on a network error — falls back to empty', async () => {
		withPlan('pro');
		httpService.post.mockReturnValue(
			throwError(() => new Error('ECONNREFUSED'))
		);

		await expect(adapter.synthesize(makeInput())).resolves.toEqual({
			text: '',
		});
	});

	it('returns empty without resolving plan when userId or question is missing', async () => {
		expect(await adapter.synthesize(makeInput({ userId: '' }))).toEqual({
			text: '',
		});
		expect(await adapter.synthesize(makeInput({ question: '' }))).toEqual({
			text: '',
		});
		expect(planResolver.resolve).not.toHaveBeenCalled();
	});
});
