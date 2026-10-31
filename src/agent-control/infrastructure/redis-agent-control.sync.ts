import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { AgentControlSync } from 'src/agent-control/application/ports/agent-control-sync.port';

export const AGENT_CONTROL_CHANNEL = 'trackerr.agents.control.changed';

export interface RedisConnectionOptions {
	host: string;
	port: number;
	password?: string;
	db: number;
}

/**
 * Propagação por Redis pub/sub (ADR-005, seção 7.1). Duas conexões, como o
 * ioredis exige: uma que publica e outra que só escuta.
 *
 * Redis fora do ar é estado degradado, não fatal: publicar falha em silêncio
 * (vira aviso no log) e a recarga de 30 s do registro cobre o resto.
 */
export class RedisAgentControlSync implements AgentControlSync {
	private readonly logger = new Logger(RedisAgentControlSync.name);
	private readonly instanceId = randomUUID();
	private readonly publisher: Redis;
	private readonly subscriber: Redis;

	constructor(connection: RedisConnectionOptions) {
		const retryStrategy = (attempts: number) =>
			Math.min(attempts * 500, 10_000);
		// Publicar não pode esperar o Redis voltar: falha na hora.
		this.publisher = new Redis({
			...connection,
			enableOfflineQueue: false,
			maxRetriesPerRequest: 1,
			lazyConnect: true,
			retryStrategy,
		});
		this.subscriber = new Redis({
			...connection,
			lazyConnect: true,
			retryStrategy,
		});

		for (const client of [this.publisher, this.subscriber]) {
			// Sem handler, o ioredis emite 'error' sem tratamento e derruba o processo.
			client.on('error', (err) =>
				this.logger.warn(`Redis do controle de agentes: ${err.message}`)
			);
		}
		this.publisher
			.connect()
			.catch((err: Error) =>
				this.logger.warn(
					`Redis indisponível no boot (publicação): ${err.message}`
				)
			);
	}

	async publishChanged(agentId: string): Promise<void> {
		try {
			await this.publisher.publish(
				AGENT_CONTROL_CHANNEL,
				JSON.stringify({ agentId, from: this.instanceId })
			);
		} catch (err) {
			this.logger.warn(
				`Não avisou as outras instâncias (${agentId}); valem os 30 s: ${(err as Error).message}`
			);
		}
	}

	subscribe(onChanged: (agentId: string) => void): void {
		this.subscriber.on('message', (_channel, raw) => {
			try {
				const message = JSON.parse(raw) as { agentId?: string; from?: string };
				// A própria instância já recarregou ao mudar.
				if (message.from === this.instanceId || !message.agentId) return;
				onChanged(message.agentId);
			} catch {
				// Mensagem que não é nossa ou veio quebrada: ignora.
			}
		});
		this.subscriber
			.subscribe(AGENT_CONTROL_CHANNEL)
			.catch((err: Error) =>
				this.logger.warn(`Não escutou o canal de agentes: ${err.message}`)
			);
	}

	async close(): Promise<void> {
		this.publisher.disconnect();
		this.subscriber.disconnect();
	}
}
