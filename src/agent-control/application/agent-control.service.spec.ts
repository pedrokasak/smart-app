import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	NotFoundException,
} from '@nestjs/common';
import { AgentRun } from 'src/agent-control/domain/agent-run.types';
import { AgentControlRegistry } from './agent-control.registry';
import { AgentActor, AgentControlService } from './agent-control.service';
import { InMemoryAgentControlStore } from './in-memory-agent-control.store.fixture';
import { AgentControlChangedNotice } from './ports/agent-control-side-effects.port';

const actor: AgentActor = { userId: 'admin-1', ref: 'usr_abc', ip: '10.0.0.1' };
const reason = 'custo acima do previsto na semana';

describe('AgentControlService', () => {
	let now: Date;
	let store: InMemoryAgentControlStore;
	let registry: AgentControlRegistry;
	let service: AgentControlService;
	let notices: AgentControlChangedNotice[];
	let validCode: string;
	let runs: AgentRun[];
	let runsFail: boolean;
	let published: string[];

	beforeEach(async () => {
		now = new Date('2026-10-27T12:00:00Z');
		store = new InMemoryAgentControlStore();
		notices = [];
		validCode = '123456';
		runs = [];
		runsFail = false;
		published = [];
		const env = { RI_WATCH_ENABLED: 'true' };
		registry = new AgentControlRegistry(
			store,
			{ apply: () => {} },
			env,
			() => now,
			{ insert: async () => {}, findSince: async () => [] },
			{
				publishChanged: async () => {},
				subscribe: () => {},
				close: async () => {},
			}
		);
		await registry.seed();
		await registry.refresh();
		service = new AgentControlService(
			registry,
			store,
			{
				verify: async (_userId, code) => {
					if (code !== validCode)
						throw new ForbiddenException('Código 2FA inválido.');
				},
			},
			{
				notify: async (notice) => {
					notices.push(notice);
				},
			},
			env,
			() => now,
			{
				insert: async () => {},
				findSince: async () => {
					if (runsFail) throw new Error('mongo fora');
					return runs;
				},
			},
			{
				publishChanged: async (agentId) => {
					published.push(agentId);
				},
				subscribe: () => {},
				close: async () => {},
			}
		);
	});

	it('lista todos os agentes com estado efetivo e origem', async () => {
		const view = await service.list();

		const riWatch = view.agents.find((agent) => agent.id === 'ri-watch')!;
		expect(riWatch.effective).toEqual({
			enabled: true,
			source: 'panel',
			pausedUntil: null,
		});
		expect(riWatch.configFields.map((field) => field.key)).toEqual([
			'enet',
			'fii',
			'notify',
			'index',
		]);

		const cleanup = view.agents.find((agent) => agent.id === 'cleanup')!;
		expect(cleanup.effective.source).toBe('locked');
		expect(cleanup.panel).toBeNull();
		expect(cleanup.lockReason).toBeTruthy();
		expect(view.killAll).toEqual({ name: 'AGENTS_KILL_ALL', active: false });
	});

	it('desliga com 2FA, motivo e versão; grava histórico e avisa os outros admins', async () => {
		const view = await service.change(actor, 'ri-watch', {
			enabled: false,
			reason,
			version: 1,
			totp: validCode,
		});

		expect(view.effective.enabled).toBe(false);
		expect(view.version).toBe(2);
		await expect(registry.isEnabled('ri-watch')).resolves.toBe(false);
		expect(store.changes).toEqual([
			expect.objectContaining({
				agentId: 'ri-watch',
				fromVersion: 1,
				toVersion: 2,
				actorRef: 'usr_abc',
				reason,
				ip: '10.0.0.1',
			}),
		]);
		await Promise.resolve();
		expect(notices).toEqual([
			expect.objectContaining({
				agentName: 'Vigia de RI',
				change: 'Ligado → Desligado',
				actorUserId: 'admin-1',
			}),
		]);
	});

	it('código 2FA errado barra antes de qualquer gravação', async () => {
		await expect(
			service.change(actor, 'ri-watch', {
				enabled: false,
				reason,
				version: 1,
				totp: '000000',
			})
		).rejects.toBeInstanceOf(ForbiddenException);
		expect(store.changes).toHaveLength(0);
		expect(store.controls.get('ri-watch')?.enabled).toBe(true);
	});

	it('versão velha devolve 409', async () => {
		await expect(
			service.change(actor, 'ri-watch', {
				enabled: false,
				reason,
				version: 7,
				totp: validCode,
			})
		).rejects.toBeInstanceOf(ConflictException);
	});

	it('agente crítico devolve 409', async () => {
		await expect(
			service.change(actor, 'cleanup', {
				enabled: false,
				reason,
				version: 1,
				totp: validCode,
			})
		).rejects.toBeInstanceOf(ConflictException);
	});

	it('desligar sem motivo devolve 400 com o código do erro', async () => {
		await expect(
			service.change(actor, 'ri-watch', {
				enabled: false,
				version: 1,
				totp: validCode,
			})
		).rejects.toMatchObject({
			response: expect.objectContaining({ code: 'reason_required' }),
		});
	});

	it('recusa configuração fora do esquema', async () => {
		await expect(
			service.change(actor, 'ri-watch', {
				config: { apiKey: 'sk-123' },
				reason,
				version: 1,
				totp: validCode,
			})
		).rejects.toBeInstanceOf(BadRequestException);
	});

	it('troca o horário entre as opções fixas', async () => {
		const view = await service.change(actor, 'rag-ingestion', {
			config: { schedule: '04h00' },
			reason,
			version: 1,
			totp: validCode,
		});
		expect(view.schedule).toBe('04h00');
		expect(view.config).toEqual({ schedule: '04h00' });
	});

	it('agente desconhecido devolve 404', async () => {
		await expect(service.get('nao-existe')).rejects.toBeInstanceOf(
			NotFoundException
		);
	});

	it('pausa por 2 h só os agentes de IA ligados', async () => {
		const result = await service.pauseAllAi(actor, { reason, totp: validCode });

		expect(result.paused).toEqual(
			expect.arrayContaining(['ri-watch', 'rag-ingestion', 'portfolio-digest'])
		);
		expect(result.paused).not.toContain('ai-eval');
		expect(result.paused).not.toContain('macro-series');
		await expect(registry.isEnabled('rag-ingestion')).resolves.toBe(false);
		await expect(registry.isEnabled('macro-series')).resolves.toBe(true);

		now = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 31_000);
		await expect(registry.isEnabled('rag-ingestion')).resolves.toBe(true);
	});

	it('falha no e-mail não derruba a mudança', async () => {
		service = new AgentControlService(
			registry,
			store,
			{ verify: async () => {} },
			{
				notify: async () => {
					throw new Error('resend fora');
				},
			},
			{},
			() => now,
			{ insert: async () => {}, findSince: async () => [] },
			{
				publishChanged: async () => {},
				subscribe: () => {},
				close: async () => {},
			}
		);
		await expect(
			service.change(actor, 'ri-watch', {
				enabled: false,
				reason,
				version: 1,
				totp: validCode,
			})
		).resolves.toMatchObject({ effective: { enabled: false } });
	});

	describe('rodadas e propagação (fase A3)', () => {
		const at = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
		const run = (over: Partial<AgentRun>): AgentRun => ({
			agentId: 'ri-watch',
			startedAt: at(2.1),
			finishedAt: at(2),
			status: 'ok',
			items: 12,
			errors: 0,
			tokens: 0,
			costBrl: null,
			error: null,
			...over,
		});

		it('a lista traz última execução, erros de 7 dias e custo de 30 dias', async () => {
			runs = [
				run({ items: 37 }),
				run({
					status: 'partial',
					errors: 2,
					finishedAt: at(30),
					costBrl: 4.5,
					tokens: 900,
				}),
			];

			const view = await service.list();
			const riWatch = view.agents.find((agent) => agent.id === 'ri-watch')!;

			expect(riWatch.lastRun).toMatchObject({ status: 'ok', items: 37 });
			expect(riWatch.errors7d).toBe(2);
			expect(riWatch.costBrl30d).toBe(4.5);
			expect(riWatch.tokens30d).toBe(900);
		});

		it('agente que nunca rodou vem sem execução e sem custo inventado', async () => {
			const view = await service.list();
			const aiEval = view.agents.find((agent) => agent.id === 'ai-eval')!;
			expect(aiEval).toMatchObject({
				lastRun: null,
				errors7d: 0,
				tokens30d: 0,
				costBrl30d: null,
			});
		});

		it('banco de rodadas fora não derruba a lista', async () => {
			runsFail = true;
			const view = await service.list();
			expect(view.agents.length).toBeGreaterThan(0);
			expect(view.agents[0].lastRun).toBeNull();
		});

		it('avisa as outras instâncias depois de gravar a mudança', async () => {
			await service.change(actor, 'ri-watch', {
				enabled: false,
				reason,
				version: 1,
				totp: validCode,
			});
			expect(published).toEqual(['ri-watch']);
		});

		it('mudança recusada não avisa ninguém', async () => {
			await expect(
				service.change(actor, 'ri-watch', {
					enabled: false,
					version: 1,
					totp: validCode,
				})
			).rejects.toBeInstanceOf(BadRequestException);
			expect(published).toEqual([]);
		});
	});
});
