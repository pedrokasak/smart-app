import {
	Inject,
	Injectable,
	Logger,
	OnApplicationBootstrap,
	OnModuleDestroy,
	Optional,
} from '@nestjs/common';
import {
	AgentRun,
	RUN_ERROR_MAX_CHARS,
} from 'src/agent-control/domain/agent-run.types';
import { collectAgentReport } from './agent-run-context';
import {
	AGENT_CONTROL_SYNC,
	AgentControlSync,
} from './ports/agent-control-sync.port';
import { AGENT_RUN_STORE, AgentRunStore } from './ports/agent-run-store.port';
import {
	AGENT_DEFINITIONS,
	findAgentDefinition,
} from 'src/agent-control/domain/agent-catalog';
import {
	AgentDefinition,
	isLocked,
} from 'src/agent-control/domain/agent-definition';
import {
	AgentControl,
	EffectiveAgentState,
} from 'src/agent-control/domain/agent-control.types';
import { resolveEffectiveState } from 'src/agent-control/domain/effective-state';
import { AgentGate } from './agent-gate.port';
import {
	AGENT_CONTROL_STORE,
	AgentControlStore,
} from './ports/agent-control-store.port';
import {
	AGENT_SCHEDULE_APPLIER,
	AgentScheduleApplier,
} from './ports/agent-control-side-effects.port';

/** Validade do estado em memória (ADR-005, seção 7.1). */
export const AGENT_CONTROL_CACHE_TTL_MS = 30_000;

/** Intervalo mínimo entre duas rodadas "puladas" registradas do mesmo agente. */
export const SKIP_RECORD_INTERVAL_MS = 60 * 60 * 1000;

export const AGENT_CONTROL_ENV = Symbol('AGENT_CONTROL_ENV');
export const AGENT_CONTROL_CLOCK = Symbol('AGENT_CONTROL_CLOCK');
export type Clock = () => Date;

/**
 * Estado dos agentes em memória, com validade de 30 s, e a porta que os
 * agendadores consultam (ADR-005, seções 5 e 7).
 *
 * Falha de leitura do banco não liga nada: vale o último estado carregado e,
 * sem nenhum (boot com o banco fora), o padrão de cada definição — e agente
 * de IA tem padrão desligado.
 *
 * No boot, semeia `agent_controls` com o estado que o ambiente produz hoje,
 * só para agente sem documento: nada muda de comportamento no dia do deploy.
 */
@Injectable()
export class AgentControlRegistry
	implements AgentGate, OnApplicationBootstrap, OnModuleDestroy
{
	private readonly logger = new Logger(AgentControlRegistry.name);
	private controls = new Map<string, AgentControl>();
	private loadedAt = 0;
	private pending: Promise<void> | null = null;
	private timer: NodeJS.Timeout | null = null;
	private readonly appliedSchedules = new Map<string, string>();
	private readonly lastSkipRecordedAt = new Map<string, number>();

	constructor(
		@Inject(AGENT_CONTROL_STORE) private readonly store: AgentControlStore,
		@Inject(AGENT_SCHEDULE_APPLIER)
		private readonly scheduleApplier: AgentScheduleApplier,
		@Inject(AGENT_CONTROL_ENV) private readonly env: NodeJS.ProcessEnv,
		@Inject(AGENT_CONTROL_CLOCK) private readonly clock: Clock,
		// Opcionais para o teste que monta o registro à mão: sem o store de
		// rodadas nada é registrado, e sem o canal vale só a recarga de 30 s.
		@Optional()
		@Inject(AGENT_RUN_STORE)
		private readonly runStore?: AgentRunStore,
		@Optional()
		@Inject(AGENT_CONTROL_SYNC)
		private readonly sync?: AgentControlSync
	) {}

	async onApplicationBootstrap(): Promise<void> {
		try {
			await this.seed();
		} catch (err) {
			this.logger.error(
				`Controle de agentes: seed falhou, valem os padrões até o banco responder: ${messageOf(err)}`
			);
		}
		await this.refresh();
		// Recarrega mesmo sem consulta, para a troca de horário e o fim da
		// pausa chegarem a todas as instâncias.
		this.timer = setInterval(
			() => void this.refresh(),
			AGENT_CONTROL_CACHE_TTL_MS
		);
		this.timer.unref?.();
		// Outra instância mudou um agente: recarrega na hora, sem esperar os 30 s.
		this.sync?.subscribe(() => void this.refresh());
	}

	async onModuleDestroy(): Promise<void> {
		if (this.timer) clearInterval(this.timer);
		await this.sync?.close();
	}

	async run<T>(agentId: string, fn: () => Promise<T>): Promise<T | undefined> {
		const startedAt = this.clock();
		if (!(await this.isEnabled(agentId))) {
			if (!this.shouldRecordSkip(agentId, startedAt)) return undefined;
			await this.recordRun({
				agentId,
				startedAt,
				finishedAt: this.clock(),
				status: 'skipped_disabled',
				items: 0,
				errors: 0,
				tokens: 0,
				costBrl: null,
				error: null,
			});
			return undefined;
		}

		const outcome = await collectAgentReport(fn);
		if (outcome.kind === 'done') {
			await this.recordRun({
				agentId,
				startedAt,
				finishedAt: this.clock(),
				status: outcome.report.errors > 0 ? 'partial' : 'ok',
				...outcome.report,
				error: null,
			});
			return outcome.value;
		}

		await this.recordRun({
			agentId,
			startedAt,
			finishedAt: this.clock(),
			status: 'failed',
			...outcome.report,
			errors: Math.max(outcome.report.errors, 1),
			error: messageOf(outcome.error).slice(0, RUN_ERROR_MAX_CHARS),
		});
		// A falha continua sendo do agente: o registro só a anota.
		throw outcome.error;
	}

	/**
	 * Job de 15 em 15 minutos desligado por uma semana não pode gerar 670
	 * linhas "puladas": uma por hora por agente já mostra que o cron disparou.
	 */
	private shouldRecordSkip(agentId: string, at: Date): boolean {
		const last = this.lastSkipRecordedAt.get(agentId);
		if (last !== undefined && at.getTime() - last < SKIP_RECORD_INTERVAL_MS) {
			return false;
		}
		this.lastSkipRecordedAt.set(agentId, at.getTime());
		return true;
	}

	/** O registro da rodada nunca derruba o agente: falha só vira aviso no log. */
	private async recordRun(run: AgentRun): Promise<void> {
		if (!this.runStore) return;
		try {
			await this.runStore.insert(run);
		} catch (err) {
			this.logger.warn(
				`Controle de agentes: não registrou a rodada de ${run.agentId}: ${messageOf(err)}`
			);
		}
	}

	/** Grava o estado inicial de quem ainda não tem documento. */
	async seed(): Promise<void> {
		const now = this.clock();
		const pending = AGENT_DEFINITIONS.filter((item) => !isLocked(item));
		// Um agente por vez, sem parar no primeiro erro: a corrida do índice
		// único entre duas instâncias subindo juntas (E11000) significa que a
		// outra já gravou, e não pode deixar os seguintes sem documento.
		const results = await Promise.allSettled(
			pending.map((definition) =>
				this.store.insertIfMissing({
					agentId: definition.id,
					enabled: definition.seedEnabled(this.env),
					config: definition.seedConfig?.(this.env) ?? {},
					pausedUntil: null,
					version: 1,
					updatedBy: 'seed',
					updatedAt: now,
					reason: 'Estado inicial lido do ambiente (ADR-005)',
				})
			)
		);
		const failed = results.filter((result) => result.status === 'rejected');
		if (failed.length) {
			this.logger.warn(
				`Controle de agentes: ${failed.length} seed(s) falharam (${messageOf((failed[0] as PromiseRejectedResult).reason)}).`
			);
		}
	}

	/**
	 * Recarrega do banco. Erro mantém o estado anterior.
	 *
	 * Com uma leitura já em andamento, espera ela e lê de novo: a leitura em
	 * curso pode ter começado antes de uma mudança que acabou de ser gravada,
	 * e quem chama logo depois de um PATCH precisa do estado novo.
	 */
	async refresh(): Promise<void> {
		if (this.pending) {
			await this.pending;
			if (this.pending) return this.pending;
		}
		this.pending = (async () => {
			try {
				const all = await this.store.findAll();
				this.controls = new Map(
					all.map((control) => [control.agentId, control])
				);
				this.loadedAt = this.clock().getTime();
				this.applySchedules();
			} catch (err) {
				this.logger.warn(
					`Controle de agentes: leitura falhou, mantendo o último estado: ${messageOf(err)}`
				);
			} finally {
				this.pending = null;
			}
		})();
		return this.pending;
	}

	async isEnabled(agentId: string): Promise<boolean> {
		return (await this.effectiveState(agentId)).enabled;
	}

	async config<T extends Record<string, unknown>>(
		agentId: string
	): Promise<T | null> {
		await this.ensureFresh();
		return this.peekConfig<T>(agentId);
	}

	peekConfig<T extends Record<string, unknown>>(agentId: string): T | null {
		this.definitionOf(agentId);
		return (this.controls.get(agentId)?.config as T | undefined) ?? null;
	}

	peekEnabled(agentId: string): boolean | null {
		const definition = this.definitionOf(agentId);
		if (!this.loadedAt) return null;
		return resolveEffectiveState(
			definition,
			this.controls.get(agentId) ?? null,
			this.env,
			this.clock()
		).enabled;
	}

	async effectiveState(agentId: string): Promise<EffectiveAgentState> {
		const definition = this.definitionOf(agentId);
		await this.ensureFresh();
		return resolveEffectiveState(
			definition,
			this.controls.get(agentId) ?? null,
			this.env,
			this.clock()
		);
	}

	/** Estado em memória, para a listagem do admin. */
	async snapshot(): Promise<Map<string, AgentControl>> {
		await this.ensureFresh();
		return new Map(this.controls);
	}

	private async ensureFresh(): Promise<void> {
		if (this.clock().getTime() - this.loadedAt >= AGENT_CONTROL_CACHE_TTL_MS) {
			await this.refresh();
		}
	}

	private definitionOf(agentId: string): AgentDefinition {
		const definition = findAgentDefinition(agentId);
		// Id desconhecido é erro de programação (typo num agendador), não um
		// agente sem controle: falha alto em vez de rodar em silêncio.
		if (!definition) throw new Error(`Agente desconhecido: ${agentId}`);
		return definition;
	}

	private applySchedules(): void {
		for (const definition of AGENT_DEFINITIONS) {
			if (!definition.scheduleOptions?.length) continue;
			const chosen = this.controls.get(definition.id)?.config?.schedule;
			const option = definition.scheduleOptions.find(
				(item) => item.id === chosen
			);
			if (!option || this.appliedSchedules.get(definition.id) === option.cron) {
				continue;
			}
			try {
				this.scheduleApplier.apply(definition, option.cron);
				this.appliedSchedules.set(definition.id, option.cron);
			} catch (err) {
				this.logger.error(
					`Controle de agentes: não aplicou o horário de ${definition.id}: ${messageOf(err)}`
				);
			}
		}
	}
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
