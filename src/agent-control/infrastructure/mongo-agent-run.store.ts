import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentRunStore } from 'src/agent-control/application/ports/agent-run-store.port';
import { AgentRun } from 'src/agent-control/domain/agent-run.types';

/** Único arquivo das rodadas de agente que conhece Mongoose. */
@Injectable()
export class MongoAgentRunStore implements AgentRunStore {
	constructor(
		@InjectModel('AgentRun') private readonly runs: Model<AgentRun>
	) {}

	async insert(run: AgentRun): Promise<void> {
		await this.runs.create(run);
	}

	async findSince(since: Date): Promise<AgentRun[]> {
		return this.runs
			.find({ finishedAt: { $gte: since } }, { _id: 0 })
			.lean<AgentRun[]>()
			.exec();
	}
}
