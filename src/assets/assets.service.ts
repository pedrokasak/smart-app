import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { Asset } from 'src/assets/schema/assets.model';
import { CreateAssetDto } from 'src/assets/dto/create-asset.dto';
import { PortfolioService } from 'src/portfolio/portfolio.service';

@Injectable()
export class AssetsService {
	constructor(
		@InjectModel('Asset') private readonly assetModel: Model<Asset>,
		@Inject(forwardRef(() => PortfolioService))
		private readonly portfolioModel: Model<Portfolio>
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
		return this.assetModel.findOne({
			portfolioId,
			symbol: new RegExp(`^${symbol}$`, 'i'),
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

	async upsertDividendHistoryEntries(
		assetId: string,
		newEntries: Array<{
			date: Date;
			value: number;
			paymentType?: 'JCP' | 'DIVIDEND' | 'RENDIMENTO' | 'OTHER';
		}>
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
			const paymentType = String(entry?.paymentType || 'DIVIDEND').toUpperCase();
			const normalizedValue = Number(entry?.value || 0).toFixed(8);
			return `${dateKey}|${paymentType}|${normalizedValue}`;
		};

		const existingHistory = Array.isArray((asset as any).dividendHistory)
			? (asset as any).dividendHistory
			: [];

		const incomingFingerprints = new Set(
			newEntries.map((entry) => toFingerprint(entry))
		);

		const keptEntries = existingHistory.filter(
			(entry: any) => !incomingFingerprints.has(toFingerprint(entry))
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

		return this.assetModel.findByIdAndUpdate(
			assetId,
			{
				$set: { dividendHistory: deduped },
			},
			{ new: true }
		);
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
