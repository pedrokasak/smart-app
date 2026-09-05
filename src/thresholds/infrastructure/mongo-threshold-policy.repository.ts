import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from 'src/users/schema/user.model';
import { ThresholdPolicyStore } from 'src/thresholds/application/ports/threshold-policy.port';
import { UserThresholdPolicyOverride } from 'src/thresholds/domain/threshold-policy';

/**
 * Le o override de politica do proprio documento do usuario
 * (`User.thresholdPolicy`, campo aditivo). Uma colecao separada so para
 * tres numeros opcionais nao se paga: a politica e lida uma vez por
 * avaliacao e o doc do usuario ja esta indexado por `_id`.
 *
 * `null` quando nao ha override — a resolucao aplica os defaults do
 * sistema. Falha de leitura tambem devolve `null` em vez de lancar: um
 * usuario sem politica customizada avaliado com os defaults e melhor que
 * uma avaliacao perdida.
 */
@Injectable()
export class MongoThresholdPolicyRepository implements ThresholdPolicyStore {
	constructor(@InjectModel('User') private readonly userModel: Model<User>) {}

	async findByUser(
		userId: string
	): Promise<UserThresholdPolicyOverride | null> {
		if (!Types.ObjectId.isValid(userId)) return null;

		const doc = await this.userModel
			.findById(userId)
			.select('thresholdPolicy')
			.lean<Pick<User, 'thresholdPolicy'> | null>();

		const policy = doc?.thresholdPolicy;
		if (!policy) return null;

		return {
			allocationDriftBandPp: numberOrUndefined(policy.allocationDriftBandPp),
			scoreDropPoints: numberOrUndefined(policy.scoreDropPoints),
			cooldownHours: numberOrUndefined(policy.cooldownHours),
		};
	}
}

function numberOrUndefined(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: undefined;
}
