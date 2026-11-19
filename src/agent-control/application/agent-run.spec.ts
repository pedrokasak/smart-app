import { Cron } from '@nestjs/schedule';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { AgentRun as AgentRunRecord } from 'src/agent-control/domain/agent-run.types';
import { AgentControlRegistry } from './agent-control.registry';
import { AgentGate } from './agent-gate.port';
import { AgentRun } from './agent-run.decorator';
import { reportAgentRun } from './agent-run-context';
import { InMemoryAgentControlStore } from './in-memory-agent-control.store.fixture';

describe('rodadas de agente (ADR-005, fase A3)', () => {
	let now: Date;
	let controls: InMemoryAgentControlStore;
	let recorded: AgentRunRecord[];
	let failInsert: boolean;
	let registry: AgentControlRegistry;

	beforeEach(async () => {
		now = new Date('2026-10-30T12:00:00Z');
		controls = new InMemoryAgentControlStore();
		recorded = [];
		failInsert = false;
		registry = new AgentControlRegistry(
			controls,
			{ apply: () => {} },
			{},
			() => now,
			{
				insert: async (run) => {
					if (failInsert) throw new Error('mongo fora');
					recorded.push(run);
				},
				findSince: async () => recorded,
			}
		);
		await registry.seed();
		await registry.refresh();
	});

	describe('AgentControlRegistry.run', () => {
		it('registra ok, com o que o agente informou durante a rodada', async () => {
			const result = await registry.run('macro-series', async () => {
				reportAgentRun({ items: 7 });
				reportAgentRun({ items: 3, tokens: 120, costBrl: 0.4 });
				return 'feito';
			});

			expect(result).toBe('feito');
			expect(recorded).toEqual([
				expect.objectContaining({
					agentId: 'macro-series',
					status: 'ok',
					items: 10,
					errors: 0,
					tokens: 120,
					costBrl: 0.4,
				}),
			]);
		});

		it('rodada com erro isolado termina como parcial', async () => {
			await registry.run('macro-series', async () => {
				reportAgentRun({ items: 8, errors: 2 });
			});
			expect(recorded[0]).toMatchObject({
				status: 'partial',
				items: 8,
				errors: 2,
			});
		});

		it('desligado: não chama o agente e registra a rodada pulada', async () => {
			const job = jest.fn();
			controls.controls.get('macro-series')!.enabled = false;
			await registry.refresh();

			await expect(registry.run('macro-series', job)).resolves.toBeUndefined();

			expect(job).not.toHaveBeenCalled();
			expect(recorded[0]).toMatchObject({
				agentId: 'macro-series',
				status: 'skipped_disabled',
			});
		});

		it('falha: registra, corta a mensagem em 300 caracteres e deixa o erro subir', async () => {
			await expect(
				registry.run('macro-series', async () => {
					throw new Error('x'.repeat(500));
				})
			).rejects.toThrow('xxx');

			expect(recorded[0]).toMatchObject({ status: 'failed', errors: 1 });
			expect(recorded[0].error).toHaveLength(300);
		});

		it('rodada que cai no fim guarda o que já tinha tratado', async () => {
			await expect(
				registry.run('macro-series', async () => {
					reportAgentRun({ items: 30, tokens: 400 });
					throw new Error('quebrou no fim');
				})
			).rejects.toThrow('quebrou no fim');

			expect(recorded[0]).toMatchObject({
				status: 'failed',
				items: 30,
				tokens: 400,
				errors: 1,
				error: 'quebrou no fim',
			});
		});

		it('agente desligado a cada 15 min grava uma rodada pulada por hora, não uma por disparo', async () => {
			controls.controls.get('macro-series')!.enabled = false;
			await registry.refresh();

			for (let minutes = 0; minutes < 120; minutes += 15) {
				now = new Date(Date.UTC(2026, 9, 30, 12, minutes));
				await registry.run('macro-series', async () => 'x');
			}

			expect(
				recorded.filter((run) => run.status === 'skipped_disabled')
			).toHaveLength(2);
		});

		it('banco de rodadas fora não derruba o agente', async () => {
			failInsert = true;
			await expect(
				registry.run('macro-series', async () => 'feito')
			).resolves.toBe('feito');
		});

		it('relatório de uma rodada não vaza para a seguinte', async () => {
			await registry.run('macro-series', async () =>
				reportAgentRun({ items: 5 })
			);
			await registry.run('macro-series', async () => undefined);
			expect(recorded.map((run) => run.items)).toEqual([5, 0]);
		});

		it('reportAgentRun fora de uma rodada não faz nada', () => {
			expect(() => reportAgentRun({ items: 5 })).not.toThrow();
		});
	});

	describe('@AgentRun', () => {
		class JobComCronAbaixo {
			constructor(public agentGate?: AgentGate) {}
			calls = 0;

			@Cron('0 4 * * *', { name: 'job-abaixo' })
			@AgentRun('macro-series')
			async run(extra = 'x'): Promise<string> {
				this.calls++;
				return extra;
			}
		}

		class JobComCronAcima {
			constructor(public agentGate?: AgentGate) {}

			@AgentRun('macro-series')
			@Cron('0 5 * * *', { name: 'job-acima' })
			async run(): Promise<string> {
				return 'ok';
			}
		}

		it('o @Cron continua achável no método embrulhado, em qualquer ordem', () => {
			expect(
				Reflect.getMetadata(
					SCHEDULE_CRON_OPTIONS,
					JobComCronAbaixo.prototype.run
				)
			).toMatchObject({ name: 'job-abaixo' });
			expect(
				Reflect.getMetadata(
					SCHEDULE_CRON_OPTIONS,
					JobComCronAcima.prototype.run
				)
			).toMatchObject({ name: 'job-acima' });
		});

		it('roda sob o controle e passa os argumentos', async () => {
			const job = new JobComCronAbaixo(registry);
			await expect(job.run('valor')).resolves.toBe('valor');
			expect(recorded[0]).toMatchObject({
				agentId: 'macro-series',
				status: 'ok',
			});
		});

		it('desligado, o método nem roda', async () => {
			controls.controls.get('macro-series')!.enabled = false;
			await registry.refresh();
			const job = new JobComCronAbaixo(registry);

			await expect(job.run()).resolves.toBeUndefined();
			expect(job.calls).toBe(0);
		});

		it('sem a porta injetada, roda como antes', async () => {
			const job = new JobComCronAbaixo();
			await expect(job.run('direto')).resolves.toBe('direto');
			expect(recorded).toHaveLength(0);
		});

		it('id de agente que não existe falha ao carregar a classe, não no primeiro cron', () => {
			expect(() => AgentRun('macro-serie')).toThrow('agente desconhecido');
		});

		it('mantém o nome do método', () => {
			expect(JobComCronAbaixo.prototype.run.name).toBe('run');
		});
	});
});
