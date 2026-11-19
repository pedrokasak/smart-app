import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentControlStore } from 'src/agent-control/application/ports/agent-control-store.port';
import {
	AgentControl,
	AgentControlChange,
	AgentControlSnapshot,
} from 'src/agent-control/domain/agent-control.types';

const CONTROL_FIELDS = {
	_id: 0,
	agentId: 1,
	enabled: 1,
	config: 1,
	pausedUntil: 1,
	version: 1,
	updatedBy: 1,
	updatedAt: 1,
	reason: 1,
};

/** Único arquivo do controle de agentes que conhece Mongoose. */
@Injectable()
export class MongoAgentControlStore implements AgentControlStore {
	constructor(
		@InjectModel('AgentControl') private readonly controls: Model<AgentControl>,
		@InjectModel('AgentControlChange')
		private readonly changes: Model<AgentControlChange>
	) {}

	async findAll(): Promise<AgentControl[]> {
		return this.controls.find({}, CONTROL_FIELDS).lean<AgentControl[]>().exec();
	}

	async findOne(agentId: string): Promise<AgentControl | null> {
		return this.controls
			.findOne({ agentId }, CONTROL_FIELDS)
			.lean<AgentControl>()
			.exec();
	}

	async insertIfMissing(control: AgentControl): Promise<void> {
		await this.controls
			.updateOne(
				{ agentId: control.agentId },
				{ $setOnInsert: control },
				{ upsert: true }
			)
			.exec();
	}

	async updateIfVersion(
		agentId: string,
		expectedVersion: number,
		next: AgentControlSnapshot & {
			updatedBy: string;
			updatedAt: Date;
			reason: string | null;
		}
	): Promise<AgentControl | null> {
		return this.controls
			.findOneAndUpdate(
				{ agentId, version: expectedVersion },
				{
					$set: {
						enabled: next.enabled,
						config: next.config,
						pausedUntil: next.pausedUntil,
						updatedBy: next.updatedBy,
						updatedAt: next.updatedAt,
						reason: next.reason,
					},
					$inc: { version: 1 },
				},
				{ new: true, projection: CONTROL_FIELDS }
			)
			.lean<AgentControl>()
			.exec();
	}

	async appendChange(change: AgentControlChange): Promise<void> {
		await this.changes.create(change);
	}

	async listChanges(
		agentId: string | null,
		limit: number
	): Promise<AgentControlChange[]> {
		return this.changes
			.find(agentId ? { agentId } : {}, { _id: 0 })
			.sort({ at: -1 })
			.limit(limit)
			.lean<AgentControlChange[]>()
			.exec();
	}
}
