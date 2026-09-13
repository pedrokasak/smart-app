import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { Asset } from 'src/assets/schema/assets.model';
import { CreateAssetDto } from 'src/assets/dto/create-asset.dto';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { DividendReceivedProducer } from 'src/assets/events/dividend-received.producer';

@Injectable()
export class AssetsService {
	private escapeRegex(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	constructor(
		@InjectModel('Asset') private readonly assetModel: Model<Asset>,
		@Inject(forwardRef(() => PortfolioService))
		private readonly portfolioModel: Model<Portfolio>,
		private readonly dividendProducer: DividendReceivedProducer
	) {}

	// Buscar todos os assets
	async findAll() {
		return this.assetModel.find();
	}

	// Buscar asset específico
	async findOne(assetId: string) {
		return this.assetModel.findById(assetId);
	}

	async findAssetBySymbolAndPortfolio(portfolioId: string, symbol: string) {
		const normalizedSymbol = String(symbol || '')
			.trim()
			.toUpperCase();
		const safePattern = this.escapeRegex(normalizedSymbol);
		return this.assetModel.findOne({
			portfolioId,
			symbol: new RegExp(`^${safePattern}$`, 'i'),
		});
	}

	async findPortfolioById(portfolioId: string) {
		return this.portfolioModel.findById(portfolioId).populate('assets');
	}

	// Criar asset
	async create(asset: CreateAssetDto) {
		return this.assetModel.create(asset);
	}

	// Atualizar asset
	async update(assetId: string, updateDto: UpdateAssetDto) {
		const existing = await this.assetModel.findById(assetId);
		if (!existing) return null;

		const quantity =
			typeof updateDto.quantity === 'number'
				? updateDto.quantity
				: existing.quantity;
		const price =
			typeof updateDto.price === 'number' ? updateDto.price : existing.price;
		const avgPrice =
			typeof (updateDto as any).avgPrice === 'number'
				? (updateDto as any).avgPrice
				: (existing as any).avgPrice;
		const costBasis = typeof avgPrice === 'number' ? avgPrice : price;

		const setUpdate: Record<string, any> = {
			total: quantity * costBasis,
			updatedAt: new Date(),
		};

		if (typeof updateDto.quantity === 'number') setUpdate.quantity = quantity;
		if (typeof updateDto.price === 'number') setUpdate.price = price;
		if (typeof (updateDto as any).name === 'string')
			setUpdate.name = (updateDto as any).name;
		if (typeof (updateDto as any).avgPrice === 'number')
			setUpdate.avgPrice = avgPrice;

		const update: Record<string, any> = { $set: setUpdate };

		if (Array.isArray((updateDto as any).dividendHistory)) {
			update.$push = {
				dividendHistory: {
					$each: (updateDto as any).dividendHistory,
				},
			};
		}

		return this.assetModel.findByIdAndUpdate(assetId, update, { new: true });
	}

	/**
	 * `replaceRange` troca o merge por substituição dentro de uma janela de
	 * datas. Existe para o extrato de movimentação, que é uma afirmação
	 * completa sobre um período: "isto é tudo que aconteceu entre A e B".
	 *
	 * Sem isso, reimportar não conserta histórico errado — duplica. A
	 * impressão digital do merge é `data|tipo|valor`, então proventos que o
	 * importador antigo carimbou com a data do upload têm chave diferente
	 * dos mesmos proventos com a data real, e as duas versões sobrevivem
	 * lado a lado, dobrando o total recebido.
	 */
	async upsertDividendHistoryEntries(
		assetId: string,
		newEntries: Array<{
			date: Date;
			value: number;
			paymentType?: 'JCP' | 'DIVIDEND' | 'RENDIMENTO' | 'OTHER';
		}>,
		options?: { replaceRange?: { from: Date; to: Date } }
	) {
		const asset = await this.assetModel.findById(assetId);
		if (!asset) return null;

		const toFingerprint = (entry: {
			date?: Date;
			value?: number;
			paymentType?: string;
		}) => {
			const parsedDate = new Date(entry?.date || 0);
			const dateKey = Number.isNaN(parsedDate.getTime())
				? 'invalid-date'
				: parsedDate.toISOString().slice(0, 10);
			const paymentType = String(
				entry?.paymentType || 'DIVIDEND'
			).toUpperCase();
			const normalizedValue = Number(entry?.value || 0).toFixed(8);
			return `${dateKey}|${paymentType}|${normalizedValue}`;
		};

		const existingHistory = Array.isArray((asset as any).dividendHistory)
			? (asset as any).dividendHistory
			: [];

		const incomingFingerprints = new Set(
			newEntries.map((entry) => toFingerprint(entry))
		);

		const replaceRange = options?.replaceRange;
		const fromTime = replaceRange
			? new Date(replaceRange.from).setHours(0, 0, 0, 0)
			: null;
		const toTime = replaceRange
			? new Date(replaceRange.to).setHours(23, 59, 59, 999)
			: null;

		const isInsideReplacedRange = (entry: any): boolean => {
			if (fromTime === null || toTime === null) return false;
			const time = new Date(entry?.date || 0).getTime();
			if (Number.isNaN(time)) return false;
			return time >= fromTime && time <= toTime;
		};

		const keptEntries = existingHistory.filter(
			(entry: any) =>
				!incomingFingerprints.has(toFingerprint(entry)) &&
				!isInsideReplacedRange(entry)
		);

		const merged = [...keptEntries, ...newEntries];
		const uniqueByFingerprint = new Map<string, any>();
		for (const entry of merged) {
			uniqueByFingerprint.set(toFingerprint(entry), entry);
		}

		const deduped = Array.from(uniqueByFingerprint.values()).sort((a, b) => {
			const aDate = new Date(a?.date || 0).getTime();
			const bDate = new Date(b?.date || 0).getTime();
			return aDate - bDate;
		});

		// Provento "novo" e o que ainda nao estava no historico — a mesma
		// impressao digital que evita a duplicata no merge decide aqui quem
		// vira evento. Reimportar o mesmo extrato nao publica nada.
		const existingFingerprints = new Set(
			existingHistory.map((entry: any) => toFingerprint(entry))
		);
		const addedEntries = Array.from(
			new Map(
				newEntries
					.filter((entry) => !existingFingerprints.has(toFingerprint(entry)))
					.map((entry) => [toFingerprint(entry), entry] as const)
			).values()
		);

		const updated = await this.assetModel.findByIdAndUpdate(
			assetId,
			{
				$set: { dividendHistory: deduped },
			},
			{ new: true }
		);

		// Depois da persistencia e sem `await` no caminho de erro: o produtor
		// nunca lanca, entao a importacao responde 200 mesmo com o
		// barramento/Redis fora do ar (TRA-136).
		if (addedEntries.length > 0) {
			await this.dividendProducer.publishForAsset(assetId, addedEntries);
		}

		return updated;
	}

	// Deletar asset
	async remove(assetId: string, portfolioId: string) {
		// Remove asset
		await this.assetModel.findByIdAndDelete(assetId);

		// Remove de portfolio
		await this.portfolioModel.findByIdAndUpdate(portfolioId, {
			$pull: { assets: assetId },
		});
	}
}
