import { AgentRun } from './agent-run.types';
import { summarizeRuns } from './agent-run-summary';

const now = new Date('2026-10-30T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

function run(over: Partial<AgentRun> = {}): AgentRun {
	return {
		agentId: 'ri-watch',
		startedAt: hoursAgo(2.1),
		finishedAt: hoursAgo(2),
		status: 'ok',
		items: 0,
		errors: 0,
		tokens: 0,
		costBrl: null,
		error: null,
		...over,
	};
}

describe('summarizeRuns', () => {
	it('última execução é a que terminou por último, mesmo pulada', () => {
		const summary = summarizeRuns(
			[
				run({ finishedAt: hoursAgo(10), items: 5 }),
				run({ finishedAt: hoursAgo(1), status: 'skipped_disabled' }),
				run({ finishedAt: hoursAgo(5), items: 9 }),
			],
			now
		).get('ri-watch');

		expect(summary?.lastRun).toMatchObject({ status: 'skipped_disabled' });
		expect(summary?.lastRun?.at).toEqual(hoursAgo(1));
	});

	it('traz a mensagem de erro da última rodada que caiu', () => {
		const summary = summarizeRuns(
			[run({ status: 'failed', error: 'timeout na CVM' })],
			now
		).get('ri-watch');
		expect(summary?.lastRun?.error).toBe('timeout na CVM');
	});

	it('mede a duração da última rodada', () => {
		const summary = summarizeRuns(
			[run({ startedAt: hoursAgo(1.5), finishedAt: hoursAgo(1) })],
			now
		).get('ri-watch');
		expect(summary?.lastRun?.durationMs).toBe(30 * 60_000);
	});

	it('erros de 7 dias somam os isolados, e rodada que caiu conta ao menos um', () => {
		const summary = summarizeRuns(
			[
				run({ status: 'partial', errors: 3 }),
				run({ status: 'failed', errors: 0, finishedAt: hoursAgo(3) }),
				run({ status: 'failed', errors: 4, finishedAt: hoursAgo(4) }),
				run({ status: 'ok' }),
			],
			now
		).get('ri-watch');
		expect(summary?.errors7d).toBe(3 + 1 + 4);
	});

	it('erro com mais de 7 dias sai da conta, mas a rodada ainda entra no custo de 30', () => {
		const summary = summarizeRuns(
			[
				run({
					status: 'failed',
					errors: 2,
					finishedAt: hoursAgo(24 * 10),
					costBrl: 1.5,
					tokens: 100,
				}),
			],
			now
		).get('ri-watch');
		expect(summary?.errors7d).toBe(0);
		expect(summary?.costBrl30d).toBe(1.5);
		expect(summary?.tokens30d).toBe(100);
	});

	it('ignora rodada com mais de 30 dias', () => {
		expect(
			summarizeRuns([run({ finishedAt: hoursAgo(24 * 31) })], now).size
		).toBe(0);
	});

	it('custo é null quando ninguém informou, e soma só o que foi informado', () => {
		expect(
			summarizeRuns([run(), run()], now).get('ri-watch')?.costBrl30d
		).toBeNull();
		expect(
			summarizeRuns(
				[run({ costBrl: 2 }), run({ costBrl: 0.5 }), run()],
				now
			).get('ri-watch')?.costBrl30d
		).toBe(2.5);
	});

	it('separa por agente', () => {
		const summaries = summarizeRuns(
			[run(), run({ agentId: 'ai-eval', status: 'failed' })],
			now
		);
		expect(summaries.get('ri-watch')?.errors7d).toBe(0);
		expect(summaries.get('ai-eval')?.errors7d).toBe(1);
	});
});
