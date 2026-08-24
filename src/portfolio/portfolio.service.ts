import {
	Injectable,
	ForbiddenException,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateAssetDto } from 'src/assets/dto/create-asset.dto';
import { Asset } from 'src/assets/schema/assets.model';
import { CreatePortfolioDto } from 'src/portfolio/dto/create-portfolio.dto';
import { UpdatePortfolioDto } from 'src/portfolio/dto/update-portfolio.dto';
import { PortfolioEnrichService } from 'src/portfolio/portfolio-enrich.service';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { PortfolioHistory } from 'src/portfolio/schema/portfolio-history.model';

@Injectable()
export class PortfolioService {
	constructor(
		@InjectModel('Portfolio') private portfolioModel: Model<Portfolio>,
		@InjectModel('PortfolioHistory')
		private portfolioHistoryModel: Model<PortfolioHistory>,
		@InjectModel('Asset') private assetModel: Model<Asset>,
		private portfolioEnrichService: PortfolioEnrichService
	) {}

	async findPortfolioById(portfolioId: string) {
		return this.portfolioModel.findById(portfolioId).populate('assets');
	}

	/**
	 * Carrega o portfólio garantindo que ele pertence ao usuário do token
	 * (TRA-89).
	 *
	 * Antes disso `GET /portfolio/:id` só recebia o id: qualquer usuário
	 * autenticado lia a carteira inteira de qualquer outro. Autorização é
	 * decidida aqui e não no controller pra não depender de cada rota nova
	 * lembrar de repetir a checagem.
	 *
	 * Portfólio inexistente e portfólio alheio devolvem o MESMO erro de
	 * propósito: distinguir os dois transforma o endpoint num oráculo de
	 * existência de ids.
	 */
	async findOwnedPortfolioById(userId: string, portfolioId: string) {
		if (!userId) {
			throw new ForbiddenException('Usuário não autenticado.');
		}
		if (!Types.ObjectId.isValid(portfolioId)) {
			throw new NotFoundException('Carteira não encontrada.');
		}

		const portfolio = await this.portfolioModel
			.findOne({ _id: portfolioId, userId })
			.populate('assets');

		if (!portfolio) {
			throw new NotFoundException('Carteira não encontrada.');
		}

		return portfolio;
	}

	/** Igual a `findOwnedPortfolioById`, mas sem carregar os ativos. */
	async assertPortfolioOwnership(
		userId: string,
		portfolioId: string
	): Promise<void> {
		if (!userId) {
			throw new ForbiddenException('Usuário não autenticado.');
		}
		if (!Types.ObjectId.isValid(portfolioId)) {
			throw new NotFoundException('Carteira não encontrada.');
		}

		const exists = await this.portfolioModel.exists({
			_id: portfolioId,
			userId,
		});

		if (!exists) {
			throw new NotFoundException('Carteira não encontrada.');
		}
	}

	async getPortfolioHistory(portfolioId: string) {
		return this.portfolioHistoryModel
			.find({ portfolioId })
			.sort({ date: 1 })
			.exec();
	}

	/**
	 * Histórico somado entre TODOS os portfólios do usuário, por dia —
	 * diferente de getPortfolioHistory, que é escopado a um portfólio só.
	 * Usuário com mais de um portfólio (raro, mas possível) tem os
	 * totalValue do mesmo dia somados numa única série.
	 */
	async getUserPortfolioHistory(
		userId: string,
		fromDate: string,
		toDate: string
	): Promise<Array<{ date: string; totalValue: number }>> {
		const rows = await this.portfolioHistoryModel
			.find({ userId, date: { $gte: fromDate, $lte: toDate } })
			.sort({ date: 1 })
			.exec();

		const byDate = new Map<string, number>();
		for (const row of rows) {
			byDate.set(row.date, (byDate.get(row.date) || 0) + row.totalValue);
		}

		return Array.from(byDate.entries())
			.map(([date, totalValue]) => ({ date, totalValue }))
			.sort((a, b) => a.date.localeCompare(b.date));
	}

	async recordHistorySnapshot(portfolioId: string, date?: string) {
		const portfolio = await this.portfolioModel
			.findById(portfolioId)
			.populate('assets');
		if (!portfolio) return;

		const assets = portfolio.assets as unknown as Asset[];
		const totalValue = assets.reduce(
			(acc, asset) => acc + (asset.total || 0),
			0
		);

		const snapshotDate = date || new Date().toISOString().split('T')[0];

		await this.portfolioHistoryModel.findOneAndUpdate(
			{ portfolioId, date: snapshotDate },
			{
				userId: portfolio.userId,
				totalValue,
			},
			{ upsert: true, new: true }
		);
	}

	/**
	 * Backfill contínuo dia-a-dia (forward-fill) do `fromDate` até hoje:
	 * grava o MESMO `totalValue` do relatório importado em todos os dias
	 * corridos do intervalo (upsert por portfolioId+date, preserva datas já
	 * existentes). Valores intermediários são estimados (não mark-to-market
	 * real) — serve para o gráfico de período mostrar uma linha contínua a
	 * partir da data do relatório compartado com os snapshots diários futuros.
	 */
	async backfillHistorySnapshots(
		portfolioId: string,
		fromDate: string,
		totalValue: number
	) {
		const portfolio = await this.portfolioModel.findById(portfolioId).lean();
		if (!portfolio) return;

		const start = new Date(fromDate);
		if (Number.isNaN(start.getTime())) return;
		start.setUTCHours(0, 0, 0, 0);

		const today = new Date();
		today.setUTCHours(0, 0, 0, 0);

		for (
			let cursor = new Date(start);
			cursor <= today;
			cursor.setUTCDate(cursor.getUTCDate() + 1)
		) {
			const dateStr = cursor.toISOString().split('T')[0];
			await this.portfolioHistoryModel.findOneAndUpdate(
				{ portfolioId, date: dateStr },
				{
					userId: portfolio.userId,
					totalValue,
				},
				{ upsert: true, new: true }
			);
		}
	}

	async getAllPortfolioIds(): Promise<string[]> {
		const portfolios = await this.portfolioModel.find({}, { _id: 1 }).lean();
		return portfolios.map((p) => String(p._id));
	}

	async getPortfolioWithAssets(portfolioId: string) {
		return this.portfolioModel.findById(portfolioId).populate('assets');
	}

	async getUserPortfolios(userId: string) {
		return this.portfolioModel.find({ userId }).populate('assets');
	}

	async findPortfolioByName(userId: string, name: string) {
		// O nome é texto do usuário e ia cru para dentro de um RegExp: um nome
		// como `(a+)+$` gera backtracking catastrófico (ReDoS) e metacaracteres
		// mudam silenciosamente o que a busca casa. Escapar mantém a intenção
		// original — comparação exata, sem diferenciar maiúsculas (TRA-89).
		const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return this.portfolioModel
			.findOne({ userId, name: new RegExp(`^${escaped}$`, 'i') })
			.populate('assets');
	}

	async findById(portfolioId: string) {
		return this.portfolioModel.findById(portfolioId);
	}

	async createPortfolio(
		userId: string,
		createDto: CreatePortfolioDto,
		userPlan: string = 'free'
	) {
		const portfolio = await this.portfolioModel.create({
			userId,
			name: createDto.name,
			ownerType: createDto.ownerType, // 'self', 'spouse', 'child'
			ownerName: createDto.ownerName,
			cpf: createDto.cpf ?? null,
			assets: [],
			plan: userPlan,
		});

		// Limite conferido DEPOIS de gravar, e desfeito se estourou (TRA-89).
		//
		// A ordem anterior era `countDocuments` e então `create`: duas
		// requisições simultâneas contavam zero antes de qualquer uma gravar,
		// e as duas passavam — plano free terminava com N carteiras. Contar
		// depois da escrita faz a corrida ser observável: quem criou a
		// segunda enxerga as duas e desfaz a própria.
		if (userPlan === 'free') {
			const count = await this.portfolioModel.countDocuments({ userId });
			if (count > 1) {
				await this.portfolioModel.deleteOne({ _id: portfolio._id });
				throw new ForbiddenException(
					'Limite de portfólios atingido. Faça upgrade para o plano Premium para criar mais portfólios.'
				);
			}
		}

		return portfolio;
	}

	async addAssetToPortfolio(
		portfolioId: string,
		createAssetDto: CreateAssetDto,
		source: 'manual' | 'b3' | 'webscrape' = 'manual'
	) {
		const asset = await this.assetModel.create({
			portfolioId,
			symbol: createAssetDto.symbol,
			name: createAssetDto.name ?? null,
			type: createAssetDto.type,
			quantity: createAssetDto.quantity,
			price: createAssetDto.price,
			total: createAssetDto.quantity * createAssetDto.price,
			source,
		});

		const enriched = await this.portfolioEnrichService.enrichAsset(asset);

		await this.portfolioModel.findByIdAndUpdate(portfolioId, {
			$push: { assets: enriched._id },
		});

		await this.recordHistorySnapshot(portfolioId);

		return enriched;
	}

	async updatePortfolio(portfolioId: string, updateDto: UpdatePortfolioDto) {
		const updatedPortfolio = await this.portfolioModel.findByIdAndUpdate(
			portfolioId,
			updateDto,
			{ new: true }
		);

		if (!updatedPortfolio) {
			throw new NotFoundException('Portfólio não encontrado.');
		}

		return updatedPortfolio;
	}

	async deletePortfolio(portfolioId: string) {
		const deletedPortfolio =
			await this.portfolioModel.findByIdAndDelete(portfolioId);

		if (!deletedPortfolio) {
			throw new NotFoundException('Portfólio não encontrado.');
		}

		return deletedPortfolio;
	}
}
