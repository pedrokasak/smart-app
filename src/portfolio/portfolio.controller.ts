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
import { parseTradesFromCsv } from 'src/fiscal/import/csv-trade-parser';
import { TradeModel } from 'src/fiscal/schema/trade.model';
import { Types } from 'mongoose';
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
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const assetId = String(req.query?.assetId || '');
		const symbolFilter = String(req.query?.symbol || '')
			.trim()
			.toUpperCase();
		const yearValue = Number(req.query?.year || 0);

		const portfolios = await this.portfolioService.getUserPortfolios(userId);
		const portfolioIds = portfolios.map((portfolio: any) => portfolio._id);
		if (!portfolioIds.length) {
			return { transactions: [] };
		}

		const tradeFilter: any = {
			userId: new Types.ObjectId(userId),
			portfolioId: { $in: portfolioIds.map((id: any) => new Types.ObjectId(id)) },
		};

		if (symbolFilter) {
			tradeFilter.symbol = symbolFilter;
		}

		if (assetId && Types.ObjectId.isValid(assetId)) {
			const asset = await this.assetService.findOne(assetId);
			if (asset) {
				const assetPortfolioId = String((asset as any).portfolioId || '');
				const isAllowed = portfolioIds.some(
					(id: any) => String(id) === assetPortfolioId
				);
				if (isAllowed) {
					tradeFilter.symbol = String((asset as any).symbol || '')
						.trim()
						.toUpperCase();
					tradeFilter.portfolioId = (asset as any).portfolioId;
				}
			}
		}

		if (Number.isFinite(yearValue) && yearValue > 1900) {
			tradeFilter.date = {
				$gte: new Date(Date.UTC(yearValue, 0, 1)),
				$lt: new Date(Date.UTC(yearValue + 1, 0, 1)),
			};
		}

		const trades = await TradeModel.find(tradeFilter)
			.sort({ date: -1 })
			.limit(2000)
			.lean();

		return {
			transactions: trades.map((trade: any) => ({
				_id: String(trade._id),
				type: trade.side,
				side: trade.side,
				quantity: Number(trade.quantity || 0),
				price: Number(trade.price || 0),
				fees: Number(trade.fees || 0),
				total: Number(trade.quantity || 0) * Number(trade.price || 0),
				symbol: String(trade.symbol || '').toUpperCase(),
				provider: trade.provider || 'b3',
				portfolioId: String(trade.portfolioId || ''),
				date: trade.date,
			})),
		};
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

		for (const assetData of parsedAssets) {
			const assetDto: CreateAssetDto = {
				symbol: assetData.symbol,
				quantity: assetData.quantity,
				price: assetData.price,
				type: assetData.type,
			};

			const asset = await this.portfolioService.addAssetToPortfolio(
				id,
				assetDto,
				'b3'
			);
			const dividendValue = dividendsBySymbol.get(assetData.symbol);
			if (dividendValue && dividendValue > 0) {
				await this.assetService.update(asset._id.toString(), {
					dividendHistory: [
						{
							date: reportDate,
							value: dividendValue / assetData.quantity,
						},
					],
				});
			}
			importedAssets.push(AssetMapper.toResponseDto(asset));
		}

		return {
			message: 'Relatório importado com sucesso',
			fiscalWarning:
				'Este importador da B3 consolida posições/dividendos e não importa notas de negociação para apuração fiscal.',
			tradesImported: 0,
			assetsImported: importedAssets.length,
			assets: importedAssets,
		};
	}

	@Post(':id/import-b3-transactions')
	@UseInterceptors(FileInterceptor('file'))
	async importB3Transactions(
		@Param('id') portfolioId: string,
		@UploadedFile() file: any,
		@Req() req: any
	) {
		if (!file) {
			throw new Error('Arquivo não enviado');
		}

		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const userPortfolios = await this.portfolioService.getUserPortfolios(userId);
		const selected = userPortfolios.find(
			(portfolio: any) => String(portfolio._id || portfolio.id) === portfolioId
		);
		if (!selected) {
			throw new Error('Carteira não encontrada para o usuário');
		}

		const fileName = String(file.originalname || '').toLowerCase();
		const isCsv =
			String(file.mimetype || '').includes('csv') || fileName.endsWith('.csv');

		let parsedTransactions: ParsedB3Transaction[] = [];
		if (isCsv) {
			parsedTransactions = parseTradesFromCsv(
				Buffer.from(file.buffer || '').toString('utf8')
			).map((trade) => ({
				symbol: trade.assetSymbol,
				side: trade.side,
				quantity: trade.quantity,
				price: trade.price,
				fees: trade.fees ?? 0,
				date: trade.date,
			}));
		} else {
			const workbook = xlsx.read(file.buffer, { type: 'buffer' });
			parsedTransactions = parseB3NegotiationWorkbook(workbook);
		}

		if (!parsedTransactions.length) {
			return {
				message:
					'Nenhuma transação encontrada. Use o Extrato de Negociações da B3 (com data, ativo, compra/venda, quantidade e preço).',
				tradesImported: 0,
			};
		}

		const existingTrades = await TradeModel.find({
			userId: new Types.ObjectId(userId),
			portfolioId: new Types.ObjectId(portfolioId),
			provider: 'b3',
			date: {
				$gte: new Date(
					Math.min(...parsedTransactions.map((transaction) => transaction.date.getTime()))
				),
				$lte: new Date(
					Math.max(...parsedTransactions.map((transaction) => transaction.date.getTime()))
				),
			},
		})
			.select('symbol side quantity price fees date')
			.lean();

		const existingKeys = new Set(
			existingTrades.map((trade: any) =>
				[
					String(trade.symbol || '').toUpperCase(),
					String(trade.side || ''),
					Number(trade.quantity || 0).toFixed(8),
					Number(trade.price || 0).toFixed(8),
					Number(trade.fees || 0).toFixed(8),
					new Date(trade.date).toISOString(),
				].join('|')
			)
		);

		const docs = parsedTransactions
			.filter((transaction) => {
				const key = [
					transaction.symbol.toUpperCase(),
					transaction.side,
					Number(transaction.quantity).toFixed(8),
					Number(transaction.price).toFixed(8),
					Number(transaction.fees || 0).toFixed(8),
					transaction.date.toISOString(),
				].join('|');
				if (existingKeys.has(key)) {
					return false;
				}
				existingKeys.add(key);
				return true;
			})
			.map((transaction) => ({
				userId: new Types.ObjectId(userId),
				portfolioId: new Types.ObjectId(portfolioId),
				provider: 'b3',
				symbol: transaction.symbol.toUpperCase(),
				side: transaction.side,
				quantity: transaction.quantity,
				price: transaction.price,
				fees: transaction.fees ?? 0,
				date: transaction.date,
			}));

		if (docs.length) {
			await TradeModel.insertMany(docs, { ordered: false });
		}

		return {
			message: 'Extrato de negociações B3 importado com sucesso.',
			tradesImported: docs.length,
			ignoredDuplicates: parsedTransactions.length - docs.length,
			totalParsed: parsedTransactions.length,
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

type ParsedB3Transaction = {
	symbol: string;
	side: 'buy' | 'sell';
	quantity: number;
	price: number;
	fees: number;
	date: Date;
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

const normalizeSymbol = (value: unknown, kind?: SheetKind): string => {
	const text = String(value ?? '').trim().toUpperCase();
	if (!text) return '';
	if (kind === 'lca') {
		return text.replace(/\s+/g, '_');
	}
	const match = text.match(/[A-Z]{4}\d{1,2}|[A-Z]{2,10}/);
	return match ? match[0] : text;
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
				const symbol = normalizeSymbol(rawSymbol, kind);
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
			const symbol = normalizeSymbol(rawSymbol, kind);
			if (!symbol || symbol.toLowerCase() === 'total') continue;

			let quantity = normalizeNumber(row[COLUMN_QUANTITY]) ?? 0;

			const totalValue =
				normalizeNumber(row[COLUMN_TOTAL]) ??
				normalizeNumber(row[COLUMN_LCA_TOTAL_CURVA]) ??
				normalizeNumber(row[COLUMN_LCA_TOTAL_MTM]);

			let price =
				normalizeNumber(row[COLUMN_PRICE]) ??
				normalizeNumber(row[COLUMN_LCA_PRICE_CURVA]) ??
				normalizeNumber(row[COLUMN_LCA_PRICE_MTM]);

			// Alguns relatórios (ex.: LCA/Renda Fixa) não trazem quantidade.
			// Usamos quantidade unitária para preservar o valor na carteira.
			if (quantity <= 0 && totalValue && totalValue > 0) {
				quantity = 1;
			}

			if ((!price || price <= 0) && totalValue && quantity > 0) {
				price = totalValue / quantity;
			}

			if (!price || price <= 0 || quantity <= 0) continue;

			const type: ParsedAsset['type'] =
				kind === 'stock'
					? 'stock'
					: kind === 'fii'
						? 'fii'
						: kind === 'etf'
							? 'etf'
							: kind === 'lca'
								? 'fund'
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

const normalizeHeaderKey = (value: string) =>
	String(value || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');

const toTradeSide = (value: unknown): 'buy' | 'sell' | null => {
	const side = normalizeHeaderKey(String(value || ''));
	if (
		[
			'c',
			'compra',
			'buy',
			'entrada',
			'credito',
			'debito de venda',
		].includes(side)
	) {
		return 'buy';
	}
	if (['v', 'venda', 'sell', 'saida', 'débito', 'debito'].includes(side)) {
		return 'sell';
	}
	return null;
};

const parseNegotiationDate = (value: unknown): Date | null => {
	if (!value) return null;
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	if (typeof value === 'number') {
		const parsedDate = xlsx.SSF.parse_date_code(value);
		if (!parsedDate) return null;
		return new Date(
			Date.UTC(parsedDate.y, parsedDate.m - 1, parsedDate.d, 0, 0, 0)
		);
	}

	const text = String(value).trim();
	if (!text) return null;
	if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
		const [day, month, year] = text.split('/').map(Number);
		const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
		return Number.isNaN(date.getTime()) ? null : date;
	}
	if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
		const date = new Date(text);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	const fallback = new Date(text);
	return Number.isNaN(fallback.getTime()) ? null : fallback;
};

const parseB3NegotiationWorkbook = (
	workbook: xlsx.WorkBook
): ParsedB3Transaction[] => {
	const transactions: ParsedB3Transaction[] = [];

	for (const sheetName of workbook.SheetNames) {
		const sheet = workbook.Sheets[sheetName];
		if (!sheet) continue;

		const rows = xlsx.utils.sheet_to_json(sheet, { defval: null }) as Record<
			string,
			unknown
		>[];
		for (const row of rows) {
			if (!row || isTotalRow(row as Record<string, any>)) continue;

			const normalizedRow = new Map<string, unknown>(
				Object.entries(row).map(([key, value]) => [normalizeHeaderKey(key), value])
			);
			const get = (keys: string[]) => {
				for (const key of keys) {
					if (normalizedRow.has(key)) {
						return normalizedRow.get(key);
					}
				}
				return null;
			};

			const symbol = normalizeSymbol(
				get([
					'codigo de negociacao',
					'codigo negociação',
					'codigo',
					'ticker',
					'ativo',
					'produto',
					'instrumento financeiro',
				])
			).toUpperCase();
			if (!symbol || symbol === 'TOTAL') continue;

			const side = toTradeSide(
				get([
					'c/v',
					'compra/venda',
					'tipo',
					'operacao',
					'tipo de movimentacao',
					'tipo de movimentação',
				])
			);
			if (!side) continue;

			const date = parseNegotiationDate(
				get([
					'data do negocio',
					'data do negócio',
					'data do pregao',
					'data do pregão',
					'data',
				])
			);
			if (!date) continue;

			const quantity =
				normalizeNumber(
					get([
						'quantidade',
						'qtd',
						'quantidade negociada',
						'quantidade executada',
					])
				) ?? 0;
			if (quantity <= 0) continue;

			let price =
				normalizeNumber(
					get([
						'preco',
						'preço',
						'preco unitario',
						'preço unitário',
						'valor unitario',
						'valor unitário',
					])
				) ?? 0;
			if (price <= 0) {
				const totalValue =
					normalizeNumber(
						get(['valor financeiro', 'valor total', 'valor da operacao'])
					) ?? 0;
				if (totalValue > 0) {
					price = totalValue / quantity;
				}
			}
			if (price <= 0) continue;

			const fees =
				normalizeNumber(
					get([
						'taxas',
						'custos',
						'corretagem',
						'emolumentos',
						'taxa de liquidacao',
						'taxa de liquidação',
					])
				) ?? 0;

			transactions.push({
				symbol,
				side,
				quantity,
				price,
				fees,
				date,
			});
		}
	}

	return transactions;
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
