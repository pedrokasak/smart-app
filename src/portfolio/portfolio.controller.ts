import {
	Body,
	Controller,
	Get,
	Param,
	Post,
	Put,
	Delete,
	Req,
	UseGuards,
	UseInterceptors,
	UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AssetsService } from 'src/assets/assets.service';
import { AssetResponseDto } from 'src/assets/dto/asset-response.dto';
import { CreateAssetDto } from 'src/assets/dto/create-asset.dto';
import { UpdateAssetDto } from 'src/assets/dto/update-asset.dto';
import { AssetMapper } from 'src/assets/mappers/asset.mapper';
import { PortfolioMapper } from 'src/portfolio/mappers/portfolio.mapper.ts';
import { CreatePortfolioDto } from 'src/portfolio/dto/create-portfolio.dto';
import { UpdatePortfolioDto } from 'src/portfolio/dto/update-portfolio.dto';
import { PortfolioResponseDto } from 'src/portfolio/dto/portfolio-response.dto';
import { PortfolioWithAssetsDto } from 'src/portfolio/dto/portfolio-with-assets.dto';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import * as xlsx from 'xlsx';

@Controller('portfolio')
@ApiTags('Portfolio')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class PortfolioController {
	constructor(
		private portfolioService: PortfolioService,
		private assetService: AssetsService,
		private subscriptionService: SubscriptionService
	) {}

	@Post('create')
	async create(
		@Body() createPortfolioDto: CreatePortfolioDto,
		@Req() req: any
	): Promise<PortfolioResponseDto> {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;

		const currentSub =
			await this.subscriptionService.findCurrentSubscriptionByUser(userId);
		const userPlan = (currentSub?.plan as any)?.name || 'free';

		const portfolio = await this.portfolioService.createPortfolio(
			userId,
			createPortfolioDto,
			userPlan
		);
		return PortfolioMapper.toResponseDto(portfolio);
	}

	@Get()
	async findAll(@Req() req: any): Promise<PortfolioResponseDto[]> {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		return PortfolioMapper.toResponseDtoArray(portfolios);
	}

	@Get('assets')
	async findAllAssets(@Req() req: any): Promise<AssetResponseDto[]> {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const assets = portfolios.flatMap((p) => (p.assets as any) || []);
		return AssetMapper.toResponseDtoArray(assets);
	}

	@Get('transactions')
	async findTransactions(@Req() req: any) {
		// Returns all transactions across all portfolios for this user
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const transactions = portfolios.flatMap((p) => {
			const assets = (p.assets as any) || [];
			return assets.flatMap((a: any) => {
				const txns = a.transactions || [];
				return txns.map((t: any) => ({
					...t,
					assetId: a._id,
					symbol: a.symbol,
				}));
			});
		});
		return { transactions };
	}

	@Get('assets/:assetId')
	async findAssetById(@Param('assetId') assetId: string, @Req() req: any) {
		// Fetch a specific asset across all user portfolios
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		for (const p of portfolios) {
			const asset = ((p.assets as any) || []).find(
				(a: any) => a._id?.toString() === assetId
			);
			if (asset) return AssetMapper.toResponseDto(asset);
		}
		return null;
	}

	@Put('assets/:assetId')
	async updateAsset(
		@Param('assetId') assetId: string,
		@Body() updateAssetDto: UpdateAssetDto
	): Promise<AssetResponseDto | null> {
		const updated = await this.assetService.update(assetId, updateAssetDto);
		return updated ? AssetMapper.toResponseDto(updated as any) : null;
	}

	@Get('summary')
	async getSummary(@Req() req: any) {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const allAssets = portfolios.flatMap((p) => (p.assets as any) || []);
		const totalValue = allAssets.reduce(
			(sum: number, a: any) => sum + (a.total || 0),
			0
		);
		return {
			totalValue,
			totalAssets: allAssets.length,
			portfolios: portfolios.length,
		};
	}

	@Get(':id')
	async findById(@Param('id') id: string): Promise<PortfolioWithAssetsDto> {
		const portfolio = await this.portfolioService.findPortfolioById(id);
		// portfolio já vem com assets populados!
		return PortfolioMapper.toResponseDtoWithAssets(portfolio, portfolio.assets);
	}

	@Get(':id/history')
	async getHistory(@Param('id') id: string) {
		return this.portfolioService.getPortfolioHistory(id);
	}

	@Post(':id/import-b3')
	@UseInterceptors(FileInterceptor('file'))
	async importB3Report(
		@Param('id') id: string,
		@UploadedFile() file: any
	): Promise<any> {
		if (!file) {
			throw new Error('Arquivo não enviado');
		}

		const workbook = xlsx.read(file.buffer, { type: 'buffer' });
		const reportDate = resolveReportDate(file?.originalname);
		const { assets: parsedAssets, dividendsBySymbol } = parseB3Workbook(
			workbook,
			reportDate
		);
		const importedAssets = [];
		let assetsCreated = 0;
		let assetsUpdated = 0;

		for (const assetData of parsedAssets) {
			const existingAsset = await this.assetService.findAssetBySymbolAndPortfolio(
				id,
				assetData.symbol
			);

			let asset: any = existingAsset;

			if (existingAsset) {
				// Para importação B3 de posição consolidada, a posição do relatório é a fonte da verdade.
				// Portanto, atualizamos o ativo existente com quantidade/preço atuais, sem duplicar registros.
				asset =
					(await this.assetService.update(existingAsset._id.toString(), {
						quantity: assetData.quantity,
						price: assetData.price,
						avgPrice: assetData.price,
					})) || existingAsset;
				assetsUpdated += 1;
			} else {
				const assetDto: CreateAssetDto = {
					symbol: assetData.symbol,
					quantity: assetData.quantity,
					price: assetData.price,
					type: assetData.type,
				};

				asset = await this.portfolioService.addAssetToPortfolio(id, assetDto, 'b3');
				assetsCreated += 1;
			}

			const dividendValue = dividendsBySymbol.get(assetData.symbol);
			if (asset && dividendValue && dividendValue > 0 && assetData.quantity > 0) {
				const dividendPerShare = dividendValue / assetData.quantity;
				const alreadyHasDividend = Array.isArray(asset.dividendHistory)
					? asset.dividendHistory.some((entry: any) => {
							const entryDate = new Date(entry?.date).toISOString().slice(0, 10);
							const reportDateKey = reportDate.toISOString().slice(0, 10);
							const entryValue = Number(entry?.value || 0);
							return (
								entryDate === reportDateKey &&
								Math.abs(entryValue - dividendPerShare) < 0.000001
							);
						})
					: false;

				if (!alreadyHasDividend) {
					await this.assetService.update(asset._id.toString(), {
						dividendHistory: [
							{
								date: reportDate,
								value: dividendPerShare,
							},
						],
					});
				}
			}
			importedAssets.push(AssetMapper.toResponseDto(asset));
		}

		await this.portfolioService.recordHistorySnapshot(id);

		return {
			message: 'Relatório importado com sucesso',
			assetsImported: importedAssets.length,
			assetsCreated,
			assetsUpdated,
			assets: importedAssets,
		};
	}

	@Post(':portfolioId/asset')
	async addAsset(
		@Param('portfolioId') portfolioId: string,
		@Body() createAssetDto: CreateAssetDto
	): Promise<AssetResponseDto> {
		const asset = await this.portfolioService.addAssetToPortfolio(
			portfolioId,
			createAssetDto
		);
		return AssetMapper.toResponseDto(asset);
	}

	@Put(':id')
	async update(
		@Param('id') id: string,
		@Body() updatePortfolioDto: UpdatePortfolioDto
	): Promise<PortfolioResponseDto> {
		const portfolio = await this.portfolioService.updatePortfolio(
			id,
			updatePortfolioDto
		);
		return PortfolioMapper.toResponseDto(portfolio);
	}

	@Delete(':id')
	async delete(@Param('id') id: string): Promise<void> {
		await this.portfolioService.deletePortfolio(id);
	}
}

type ParsedAsset = {
	symbol: string;
	quantity: number;
	price: number;
	type: CreateAssetDto['type'];
};

type SheetKind = 'stock' | 'etf' | 'fii' | 'lca' | 'dividend';

const COLUMN_SYMBOL = 'Código de Negociação';
const COLUMN_QUANTITY = 'Quantidade';
const COLUMN_PRICE = 'Preço de Fechamento';
const COLUMN_TOTAL = 'Valor Atualizado';

const COLUMN_LCA_CODE = 'Código';
const COLUMN_LCA_TOTAL_CURVA = 'Valor Atualizado CURVA';
const COLUMN_LCA_TOTAL_MTM = 'Valor Atualizado MTM';
const COLUMN_LCA_PRICE_CURVA = 'Preço Atualizado CURVA';
const COLUMN_LCA_PRICE_MTM = 'Preço Atualizado MTM';
const COLUMN_DIVIDEND_SYMBOL = 'Produto';
const COLUMN_DIVIDEND_VALUE = 'Valor líquido';

const normalizeNumber = (value: unknown): number | null => {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;

	const text = String(value).trim();
	if (!text || text === '-' || text.toLowerCase() === 'total') return null;

	let normalized = text;
	if (normalized.includes(',') && normalized.includes('.')) {
		normalized = normalized.replace(/\./g, '').replace(',', '.');
	} else if (normalized.includes(',')) {
		normalized = normalized.replace(/\./g, '').replace(',', '.');
	}

	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : null;
};

const isTotalRow = (row: Record<string, any>): boolean =>
	Object.values(row).some((value) => {
		if (typeof value !== 'string') return false;
		return value.trim().toLowerCase() === 'total';
	});

const detectSheetKind = (headers: string[]): SheetKind | null => {
	const headerSet = new Set(headers.map((h) => h.trim()));

	if (headerSet.has('Tipo de Evento') && headerSet.has('Valor líquido')) {
		return 'dividend';
	}
	if (headerSet.has('Emissor') && headerSet.has('Indexador')) return 'lca';
	if (headerSet.has('CNPJ da Empresa')) return 'stock';
	if (headerSet.has('Administrador')) return 'fii';
	if (headerSet.has('CNPJ do Fundo')) return 'etf';
	return null;
};

const parseB3Workbook = (
	workbook: xlsx.WorkBook,
	reportDate: Date
): { assets: ParsedAsset[]; dividendsBySymbol: Map<string, number> } => {
	void reportDate;
	const assetsByKey = new Map<
		string,
		{ symbol: string; type: ParsedAsset['type']; quantity: number; total: number }
	>();
	const dividendsBySymbol = new Map<string, number>();
	const quantityBySymbol = new Map<string, number>();

	for (const sheetName of workbook.SheetNames) {
		const sheet = workbook.Sheets[sheetName];
		if (!sheet) continue;

		const headerRows = xlsx.utils.sheet_to_json(sheet, {
			header: 1,
			defval: null,
		}) as any[];
		const headers = (headerRows[0] || []).map((value: any) =>
			String(value ?? '').trim()
		);
		const kind = detectSheetKind(headers);
		if (!kind) continue;

		const rows = xlsx.utils.sheet_to_json(sheet, { defval: null }) as Record<
			string,
			any
		>[];

		for (const row of rows) {
			if (!row || isTotalRow(row)) continue;

			if (kind === 'dividend') {
				const rawSymbol = row[COLUMN_DIVIDEND_SYMBOL];
				const symbol = String(rawSymbol ?? '').trim();
				if (!symbol || symbol.toLowerCase() === 'total') continue;

				const value = normalizeNumber(row[COLUMN_DIVIDEND_VALUE]);
				if (!value || value <= 0) continue;

				const key = symbol.toUpperCase();
				dividendsBySymbol.set(key, (dividendsBySymbol.get(key) ?? 0) + value);
				continue;
			}

			const rawSymbol =
				kind === 'lca'
					? row[COLUMN_LCA_CODE] ?? row['Produto']
					: row[COLUMN_SYMBOL];
			const symbol = String(rawSymbol ?? '').trim();
			if (!symbol || symbol.toLowerCase() === 'total') continue;

			const quantity = normalizeNumber(row[COLUMN_QUANTITY]) ?? 0;
			if (quantity <= 0) continue;

			const totalValue =
				normalizeNumber(row[COLUMN_TOTAL]) ??
				normalizeNumber(row[COLUMN_LCA_TOTAL_CURVA]) ??
				normalizeNumber(row[COLUMN_LCA_TOTAL_MTM]);

			let price =
				normalizeNumber(row[COLUMN_PRICE]) ??
				normalizeNumber(row[COLUMN_LCA_PRICE_CURVA]) ??
				normalizeNumber(row[COLUMN_LCA_PRICE_MTM]);

			if ((!price || price <= 0) && totalValue && quantity > 0) {
				price = totalValue / quantity;
			}

			if (!price || price <= 0) continue;

			const type: ParsedAsset['type'] =
				kind === 'stock'
					? 'stock'
					: kind === 'fii'
						? 'fii'
						: kind === 'etf'
							? 'etf'
							: 'other';

			const key = `${type}:${symbol.toUpperCase()}`;
			const existing = assetsByKey.get(key);
			const total = totalValue ?? price * quantity;
			if (existing) {
				existing.quantity += quantity;
				existing.total += total;
			} else {
				assetsByKey.set(key, {
					symbol: symbol.toUpperCase(),
					type,
					quantity,
					total,
				});
			}
			quantityBySymbol.set(
				symbol.toUpperCase(),
				(quantityBySymbol.get(symbol.toUpperCase()) ?? 0) + quantity
			);
		}
	}

	const assets = Array.from(assetsByKey.values()).map((asset) => ({
		symbol: asset.symbol,
		type: asset.type,
		quantity: asset.quantity,
		price: asset.total / asset.quantity,
	}));

	// Ajusta dividendos para ativos que existam no relatório
	for (const [symbol, totalDividend] of dividendsBySymbol.entries()) {
		if (!quantityBySymbol.has(symbol)) {
			dividendsBySymbol.delete(symbol);
			continue;
		}
		if (!totalDividend || totalDividend <= 0) {
			dividendsBySymbol.delete(symbol);
		}
	}

	return { assets, dividendsBySymbol };
};

const resolveReportDate = (fileName?: string): Date => {
	if (!fileName) return new Date();

	const match = fileName.match(/(19|20)\\d{2}/);
	if (match) {
		const year = Number(match[0]);
		return new Date(Date.UTC(year, 11, 31));
	}

	return new Date();
};
