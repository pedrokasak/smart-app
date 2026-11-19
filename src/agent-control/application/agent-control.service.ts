import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import {
	AGENT_DEFINITIONS,
	LOCK_REASONS,
	findAgentDefinition,
} from 'src/agent-control/domain/agent-catalog';
import {
	AgentChangeError,
	AgentChangeInput,
	planAgentChange,
	snapshotOf,
} from 'src/agent-control/domain/agent-change';
import {
	AgentDefinition,
	isAi,
	isLocked,
} from 'src/agent-control/domain/agent-definition';
import {
	AgentControl,
	AgentControlChange,
	AgentControlSnapshot,
	EffectiveAgentState,
} from 'src/agent-control/domain/agent-control.types';
import {
	envKills,
	killAllActive,
	AGENTS_KILL_ALL_ENV,
} from 'src/agent-control/domain/env-switch';
import { resolveEffectiveState } from 'src/agent-control/domain/effective-state';
import {
	AGENT_CONTROL_CLOCK,
	AGENT_CONTROL_ENV,
	AgentControlRegistry,
	Clock,
} from './agent-control.registry';
import {
	AgentConfigField,
	describeChange,
	describeConfigFields,
} from './agent-control.view';
import {
	AGENT_CONTROL_STORE,
	AgentControlStore,
} from './ports/agent-control-store.port';
import {
	AGENT_CONTROL_SYNC,
	AgentControlSync,
} from './ports/agent-control-sync.port';
import { AGENT_RUN_STORE, AgentRunStore } from './ports/agent-run-store.port';
import { randomUUID } from 'crypto';
import {
	AUDIT_TRAIL,
	AuditTrail,
} from 'src/audit/application/audit-trail.port';
import { sha256 } from 'src/audit/domain/audit-event';
import {
	AgentRunSummary,
	COST_WINDOW_DAYS,
} from 'src/agent-control/domain/agent-run.types';
import { summarizeRuns } from 'src/agent-control/domain/agent-run-summary';
import {
	AGENT_CHANGE_NOTIFIER,
	AgentChangeNotifier,
	STEP_UP_VERIFIER,
	StepUpVerifier,
} from './ports/agent-control-side-effects.port';

export interface AgentActor {
	userId: string;
	/** HMAC do id: é o que vai para o histórico. */
	ref: string;
	ip: string | null;
}

export interface AgentView {
	id: string;
	name: string;
	kind: AgentDefinition['kind'];
	schedule: string;
	criticality: AgentDefinition['criticality'];
	effective: EffectiveAgentState;
	/** Estado gravado no painel; `null` para crítico. */
	panel: { enabled: boolean; pausedUntil: Date | null } | null;
	envKillSwitch: { name: string; active: boolean } | null;
	lockReason: string | null;
	config: Record<string, unknown> | null;
	configFields: AgentConfigField[];
	version: number | null;
	updatedAt: Date | null;
	detailRoute: string | null;
	/** Rodadas dos últimos 30 dias (fase A3); zerado para quem nunca rodou. */
	lastRun: AgentRunSummary['lastRun'];
	errors7d: number;
	tokens30d: number;
	costBrl30d: number | null;
}

export interface AgentListView {
	killAll: { name: string; active: boolean };
	agents: AgentView[];
}

const ERROR_MESSAGES: Record<AgentChangeError['code'], string> = {
	locked: 'Agente crítico: só o ambiente do servidor pode pará-lo.',
	no_change: 'Nada mudou: o agente já está nesse estado.',
	not_configurable: 'Este agente não tem configuração editável.',
	invalid_config: 'Configuração fora do permitido para este agente.',
	reason_required: 'Escreva o motivo com pelo menos 10 caracteres.',
	reason_too_long: 'O motivo tem no máximo 300 caracteres.',
};

/**
 * Casos de uso do painel de agentes (ADR-005, seções 6, 8 e 9).
 *
 * Ordem de uma mudança: o agente existe → o código 2FA confere (antes de
 * qualquer outra validação, para a contagem de tentativas valer sempre) →
 * a versão ainda é a que o painel viu → a mudança é válida → grava com
 * controle otimista → histórico → recarrega o estado → e-mail aos outros
 * admins, sem segurar a resposta.
 */
@Injectable()
export class AgentControlService {
	private readonly logger = new Logger(AgentControlService.name);

	constructor(
		private readonly registry: AgentControlRegistry,
		@Inject(AGENT_CONTROL_STORE) private readonly store: AgentControlStore,
		@Inject(STEP_UP_VERIFIER) private readonly stepUp: StepUpVerifier,
		@Inject(AGENT_CHANGE_NOTIFIER)
		private readonly notifier: AgentChangeNotifier,
		@Inject(AGENT_CONTROL_ENV) private readonly env: NodeJS.ProcessEnv,
		@Inject(AGENT_CONTROL_CLOCK) private readonly clock: Clock,
		@Inject(AGENT_RUN_STORE) private readonly runs: AgentRunStore,
		@Inject(AGENT_CONTROL_SYNC) private readonly sync: AgentControlSync,
		@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail
	) {}

	async list(): Promise<AgentListView> {
		const controls = await this.registry.snapshot();
		const now = this.clock();
		const summaries = await this.runSummaries(now);
		return {
			killAll: { name: AGENTS_KILL_ALL_ENV, active: killAllActive(this.env) },
			agents: AGENT_DEFINITIONS.map((definition) =>
				this.toView(
					definition,
					controls.get(definition.id) ?? null,
					now,
					summaries.get(definition.id)
				)
			),
		};
	}

	async get(agentId: string): Promise<AgentView> {
		const definition = this.definitionOf(agentId);
		const control = await this.store.findOne(agentId);
		const now = this.clock();
		const summaries = await this.runSummaries(now);
		return this.toView(definition, control, now, summaries.get(agentId));
	}

	/**
	 * Rodadas dos últimos 30 dias, resumidas. Falha de leitura não derruba a
	 * lista: os números ficam zerados e o painel continua mudando agentes.
	 */
	private async runSummaries(now: Date): Promise<Map<string, AgentRunSummary>> {
		try {
			const since = new Date(
				now.getTime() - COST_WINDOW_DAYS * 24 * 60 * 60 * 1000
			);
			return summarizeRuns(await this.runs.findSince(since), now);
		} catch (err) {
			this.logger.warn(
				`Rodadas dos agentes indisponíveis: ${(err as Error)?.message ?? err}`
			);
			return new Map();
		}
	}

	async changes(
		agentId: string | null,
		limit = 50
	): Promise<AgentControlChange[]> {
		if (agentId) this.definitionOf(agentId);
		return this.store.listChanges(agentId, Math.min(Math.max(limit, 1), 200));
	}

	async change(
		actor: AgentActor,
		agentId: string,
		input: AgentChangeInput & { version: number; totp: string }
	): Promise<AgentView> {
		const definition = this.definitionOf(agentId);
		await this.stepUp.verify(actor.userId, input.totp);
		await this.applyOne(actor, definition, input, input.version);
		return this.get(agentId);
	}

	/**
	 * Pausa por 2 h todos os agentes de IA que estão ligados agora — o freio
	 * para provedor de LLM instável ou custo fora do previsto. Jobs de dados
	 * e críticos seguem rodando.
	 */
	async pauseAllAi(
		actor: AgentActor,
		input: { reason: string; totp: string }
	): Promise<{ paused: string[] }> {
		await this.stepUp.verify(actor.userId, input.totp);
		const paused: string[] = [];
		for (const definition of AGENT_DEFINITIONS) {
			if (!isAi(definition) || isLocked(definition)) continue;
			if (!(await this.registry.isEnabled(definition.id))) continue;
			const current = await this.store.findOne(definition.id);
			if (!current) continue;
			try {
				await this.applyOne(
					actor,
					definition,
					{ pause: 'two_hours', reason: input.reason },
					current.version,
					{ current, refresh: false }
				);
				paused.push(definition.id);
			} catch (err) {
				// Motivo inválido vale para todos: sobe na primeira vez.
				if (err instanceof BadRequestException) throw err;
				this.logger.warn(
					`Pausa global: ${definition.id} ficou de fora: ${(err as Error)?.message ?? err}`
				);
			}
		}
		// Uma recarga só no fim, e não uma por agente.
		await this.registry.refresh();
		return { paused };
	}

	private async applyOne(
		actor: AgentActor,
		definition: AgentDefinition,
		input: AgentChangeInput,
		expectedVersion: number,
		options: { current?: AgentControl; refresh?: boolean } = {}
	): Promise<void> {
		if (isLocked(definition)) {
			throw new ConflictException(ERROR_MESSAGES.locked);
		}
		const current =
			options.current ?? (await this.store.findOne(definition.id));
		if (!current) {
			throw new ConflictException(
				'O estado deste agente ainda não foi criado. Tente de novo em instantes.'
			);
		}
		if (current.version !== expectedVersion) {
			throw new ConflictException(
				'Outra mudança chegou antes. Recarregue a lista e tente de novo.'
			);
		}

		const now = this.clock();
		const plan = planAgentChange(definition, current, input, now);
		if (plan.ok === false) {
			const { error } = plan;
			throw new BadRequestException({
				code: error.code,
				message: ERROR_MESSAGES[error.code],
				...(error.code === 'invalid_config' ? { issues: error.issues } : {}),
			});
		}

		const reason = (input.reason ?? '').trim() || null;
		const saved = await this.store.updateIfVersion(
			definition.id,
			current.version,
			{
				...plan.next,
				updatedBy: actor.ref,
				updatedAt: now,
				reason,
			}
		);
		if (!saved) {
			throw new ConflictException(
				'Outra mudança chegou antes. Recarregue a lista e tente de novo.'
			);
		}

		const before = snapshotOf(current);
		const auditEventId = randomUUID();
		await this.store.appendChange({
			agentId: definition.id,
			fromVersion: current.version,
			toVersion: saved.version,
			before,
			after: plan.next,
			actorRef: actor.ref,
			reason,
			ip: actor.ip,
			at: now,
			auditEventId,
		});
		await this.sealChange(
			auditEventId,
			definition.id,
			current.version,
			saved.version,
			before,
			plan.next,
			actor.ref,
			reason,
			now
		);
		if (options.refresh !== false) await this.registry.refresh();
		// Atalho para as outras instâncias; o adaptador nunca lança.
		await this.sync.publishChanged(definition.id);

		void this.notifier
			.notify({
				agentName: definition.name,
				change: describeChange(before, plan.next),
				reason,
				actorUserId: actor.userId,
				at: now,
			})
			.catch((err) =>
				this.logger.warn(
					`Aviso aos admins falhou (${definition.id}): ${(err as Error)?.message ?? err}`
				)
			);
	}

	/**
	 * Entrega a mudança à trilha encadeada (ADR-004/005, fase A4). O conteúdo
	 * entra só pelo hash: o motivo, texto livre de uma pessoa, fica no
	 * histórico apagável e a trilha leva apenas o SHA-256 dele.
	 *
	 * A mudança já foi gravada e o histórico dela também. Se a trilha falhar,
	 * o erro vai para o log em nível de erro, com o id do evento, e a
	 * resposta não muda: desfazer a mudança de um agente por causa da trilha
	 * seria pior, e o histórico (`agent_control_changes`) continua com ela.
	 */
	private async sealChange(
		eventId: string,
		agentId: string,
		fromVersion: number,
		toVersion: number,
		before: AgentControlSnapshot,
		after: AgentControlSnapshot,
		actorRef: string,
		reason: string | null,
		at: Date
	): Promise<void> {
		try {
			await this.audit.record({
				eventId,
				type: 'agent.control.changed',
				version: 1,
				subject: agentId,
				actorRef,
				occurredAt: at,
				payload: {
					agentId,
					fromVersion,
					toVersion,
					before,
					after,
					reasonSha256: reason ? sha256(reason) : null,
				},
			});
		} catch (err) {
			this.logger.error(
				`Trilha de auditoria: a mudança de ${agentId} (v${toVersion}) ficou sem evento ${eventId}: ${(err as Error)?.message ?? err}`
			);
		}
	}

	private toView(
		definition: AgentDefinition,
		control: AgentControl | null,
		now: Date,
		summary?: AgentRunSummary
	): AgentView {
		const locked = isLocked(definition);
		return {
			id: definition.id,
			name: definition.name,
			kind: definition.kind,
			schedule: this.scheduleLabel(definition, control),
			criticality: definition.criticality,
			effective: resolveEffectiveState(definition, control, this.env, now),
			panel:
				locked || !control
					? null
					: { enabled: control.enabled, pausedUntil: control.pausedUntil },
			envKillSwitch: definition.envKillSwitch
				? {
						name: definition.envKillSwitch,
						active: envKills(this.env[definition.envKillSwitch]),
					}
				: null,
			lockReason: locked ? (LOCK_REASONS[definition.id] ?? null) : null,
			config: locked ? null : (control?.config ?? null),
			configFields: describeConfigFields(definition),
			version: control?.version ?? null,
			updatedAt: control?.updatedAt ?? null,
			detailRoute: definition.detailRoute ?? null,
			lastRun: summary?.lastRun ?? null,
			errors7d: summary?.errors7d ?? 0,
			tokens30d: summary?.tokens30d ?? 0,
			costBrl30d: summary?.costBrl30d ?? null,
		};
	}

	private scheduleLabel(
		definition: AgentDefinition,
		control: AgentControl | null
	): string {
		const chosen = control?.config?.schedule;
		const option = definition.scheduleOptions?.find(
			(item) => item.id === chosen
		);
		return option?.label ?? definition.schedule;
	}

	private definitionOf(agentId: string): AgentDefinition {
		const definition = findAgentDefinition(agentId);
		if (!definition) throw new NotFoundException('Agente não encontrado.');
		return definition;
	}
}
