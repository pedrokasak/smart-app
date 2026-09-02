import {
	Injectable,
	BadRequestException,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PortfolioTargetAllocation } from './schema/portfolio-target-allocation.model';
import { UpsertTargetAllocationDto } from './dto/upsert-target-allocation.dto';

/**
 * Forma "achatada" (pós `.lean()`) do documento. O tipo `Document` do
 * schema carrega métodos e o `client` interno da conexão do Mongoose, que
 * não sobrevivem ao `.lean()` — usar `PortfolioTargetAllocation` como
 * retorno aqui quebra o typecheck.
 */
export type TargetAllocationData = {
	stocks?: number;
	crypto?: number;
	fiis?: number;
	other?: number;
};

@Injectable()
export class TargetAllocationService {
	constructor(
		@InjectModel('PortfolioTargetAllocation')
		private readonly targetAllocationModel: Model<PortfolioTargetAllocation>
	) {}

	/**
	 * Devolve a meta do usuário, ou `null` quando ele nunca configurou uma —
	 * mesma semântica do `localStorage.getItem` que esta rota substitui.
	 */
	async findByUser(userId: string): Promise<TargetAllocationData | null> {
		if (!Types.ObjectId.isValid(userId)) {
			throw new BadRequestException('Invalid user id.');
		}
		return this.targetAllocationModel
			.findOne({ user: userId })
			.lean<TargetAllocationData | null>();
	}

	async upsertForUser(
		userId: string,
		dto: UpsertTargetAllocationDto
	): Promise<TargetAllocationData> {
		if (!Types.ObjectId.isValid(userId)) {
			throw new BadRequestException('Invalid user id.');
		}

		const total = [dto.stocks, dto.crypto, dto.fiis, dto.other]
			.filter((value) => typeof value === 'number')
			.reduce((sum, value) => sum + (value as number), 0);

		// Tolerância de arredondamento: o front pode mandar 33.33 x3 + 0.01.
		if (total > 100.01) {
			throw new BadRequestException(
				'A soma dos percentuais de alocação não pode ultrapassar 100%.'
			);
		}

		const updated = await this.targetAllocationModel
			.findOneAndUpdate(
				{ user: userId },
				{
					$set: {
						stocks: dto.stocks,
						crypto: dto.crypto,
						fiis: dto.fiis,
						other: dto.other,
					},
				},
				{ new: true, upsert: true, setDefaultsOnInsert: true }
			)
			.lean<TargetAllocationData | null>();

		if (!updated) {
			throw new NotFoundException('Falha ao salvar meta de alocação.');
		}

		return updated;
	}
}
