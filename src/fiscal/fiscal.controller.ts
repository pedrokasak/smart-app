import {
	Body,
	Controller,
	Get,
	Post,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Types } from 'mongoose';
import { AiService } from 'src/ai/ai.service';
import { AssetModel } from 'src/assets/schema/assets.model';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { GenerateIrReportDto } from 'src/fiscal/dto/generate-ir-report.dto';
import { GenerateReportDto } from 'src/fiscal/dto/generate-report.dto';
import { FiscalService } from 'src/fiscal/fiscal.service';
import { TradeModel } from 'src/fiscal/schema/trade.model';
import { IrReportService } from 'src/fiscal/services/ir-report.service';
import { PortfolioReportService } from 'src/fiscal/services/portfolio-report.service';
import { PortfolioModel } from 'src/portfolio/schema/portfolio.model';
import { StockService } from 'src/stocks/stocks.service';

@ApiTags('fiscal')
@ApiBearerAuth('access-token')
@Controller('fiscal')
@UseGuards(JwtAuthGuard)
export class FiscalController {
	constructor(
		private readonly irReportService: IrReportService,
		private readonly fiscalService: FiscalService,
		private readonly stockService: StockService,
		private readonly portfolioReportService: PortfolioReportService,
		private readonly aiService: AiService
	) {}

	@Get('optimizer')
	@ApiOperation({
		summary:
			'Otimizador fiscal: identifica prejuízo acumulado e oportunidades de tax-loss harvesting',
	})
	async getOptimizer(@Req() req: any, @Query('year') year?: string) {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const objectUserId = new Types.ObjectId(userId);
		const yearNum = Number.isFinite(Number(year))
			? Number(year)
			: new Date().getFullYear();
		const yearEnd = new Date(Date.UTC(yearNum, 11, 31, 23, 59, 59, 999));

		const [portfolios, trades] = await Promise.all([
			PortfolioModel.find({ userId: objectUserId }).select('_id').lean(),
			TradeModel.find({
				userId: objectUserId,
				date: { $lte: yearEnd },
			})
				.sort({ date: 1 })
				.lean(),
		]);

		const portfolioIds = portfolios.map((portfolio: any) => portfolio._id);
		const assets = portfolioIds.length
			? await AssetModel.find({
					portfolioId: { $in: portfolioIds },
					quantity: { $gt: 0 },
				}).lean()
			: [];

		const assetTypeBySymbol: Record<string, string> = {};
		for (const asset of assets) {
			const symbol = String(asset.symbol || '').toUpperCase();
			if (symbol) {
				assetTypeBySymbol[symbol] = String(asset.type || '');
			}
		}

		const losses = this.fiscalService.calculateAccumulatedLosses(
			trades.map((trade: any) => ({
				assetSymbol: String(trade.symbol || '').toUpperCase(),
				side: trade.side,
				quantity: Number(trade.quantity || 0),
				price: Number(trade.price || 0),
				fees: Number(trade.fees || 0),
				date: new Date(trade.date),
			})),
			assetTypeBySymbol,
			yearNum
		);

		const opportunities = assets
			.map((asset: any) => {
				const symbol = String(asset.symbol || '').toUpperCase();
				const quantity = Number(asset.quantity || 0);
				const averagePrice = Number(asset.avgPrice || asset.price || 0);
				const marketPrice = Number(asset.currentPrice || asset.price || 0);
				if (!symbol || quantity <= 0 || averagePrice <= 0 || marketPrice <= 0) {
					return null;
				}

				const category = this.fiscalService.getCategoryForAsset(
					symbol,
					assetTypeBySymbol[symbol]
				);
				const rate = category === 'fii' ? 0.2 : 0.15;
				const potentialGain = (marketPrice - averagePrice) * quantity;
				if (potentialGain <= 0) return null;

				const availableLoss =
					category === 'stock'
						? losses.stock
						: category === 'fii'
							? losses.fii
							: losses.crypto;
				if (availableLoss <= 0) return null;

				const offsetUsed = Math.min(potentialGain, availableLoss);
				const taxableAfterOffset = Math.max(potentialGain - offsetUsed, 0);
				const estimatedTaxWithoutOffset = potentialGain * rate;
				const estimatedTaxWithOffset = taxableAfterOffset * rate;

				return {
					symbol,
					category,
					quantity,
					averagePrice: Number(averagePrice.toFixed(2)),
					marketPrice: Number(marketPrice.toFixed(2)),
					potentialGain: Number(potentialGain.toFixed(2)),
					availableLoss: Number(availableLoss.toFixed(2)),
					offsetUsed: Number(offsetUsed.toFixed(2)),
					estimatedTaxWithoutOffset: Number(estimatedTaxWithoutOffset.toFixed(2)),
					estimatedTaxWithOffset: Number(estimatedTaxWithOffset.toFixed(2)),
					taxSaved: Number(
						(estimatedTaxWithoutOffset - estimatedTaxWithOffset).toFixed(2)
					),
					canZeroTax: estimatedTaxWithOffset <= 0,
					headline:
						estimatedTaxWithOffset <= 0
							? `Se vender ${symbol} hoje, o imposto estimado da operação pode ser zero pelo prejuízo acumulado (tax-loss harvesting).`
							: `Se vender ${symbol} hoje, parte do lucro pode ser compensada com prejuízo acumulado, reduzindo o imposto.`,
				};
			})
			.filter(Boolean)
			.sort((a: any, b: any) => b.taxSaved - a.taxSaved)
			.slice(0, 5);

		let aiExplanation: string | null = null;
		try {
			const aiResponse = await this.aiService.simulate({
				type: 'fiscal_optimizer_explain',
				year: yearNum,
				accumulatedLoss: losses.total,
				topOpportunity: opportunities[0] || null,
			});
			aiExplanation =
				aiResponse?.summary ||
				aiResponse?.message ||
				aiResponse?.insight ||
				null;
		} catch {
			aiExplanation = null;
		}

		return {
			year: yearNum,
			accumulatedLosses: losses,
			opportunities,
			explanation:
				aiExplanation ||
				'Tax-loss harvesting é usar prejuízos acumulados para compensar lucros em vendas futuras, reduzindo o imposto devido. Quando o prejuízo acumulado cobre todo o lucro da venda, o imposto estimado da operação pode ficar zero.',
		};
	}

	@Get('report')
	@ApiOperation({ summary: 'Gera relatórios (fiscal, transações, ativos)' })
	async getPortfolioReport(
		@Req() req: any,
		@Query() query: GenerateReportDto,
		@Res() res: Response
	) {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const type = query.type;
		const year = query.year ? Number(query.year) : undefined;
		const format = query.format || 'json';

		const reportData = await this.portfolioReportService.buildReportData(
			userId,
			type,
			year
		);

		if (format === 'pdf') {
			const pdfBuffer = await this.portfolioReportService.renderPdf(reportData);
			res.setHeader('Content-Type', 'application/pdf');
			res.setHeader(
				'Content-Disposition',
				`attachment; filename="${type}-report-${reportData.year}.pdf"`
			);
			res.setHeader('Content-Length', pdfBuffer.length.toString());
			return res.send(pdfBuffer);
		}

		return res.json(reportData);
	}

	@Get('summary')
	@ApiOperation({ summary: 'Resumo fiscal por mês (IR estimado)' })
	async getSummary(@Req() req: any, @Query('year') year?: string) {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const objectUserId = new Types.ObjectId(userId);
		let yearNum = year ? Number(year) : new Date().getFullYear();
		if (!Number.isFinite(yearNum) || !year) {
			const latestTrade = await TradeModel.findOne({
				userId: objectUserId,
			})
				.sort({ date: -1 })
				.select('date')
				.lean();
			yearNum = latestTrade?.date
				? new Date(latestTrade.date).getUTCFullYear()
				: new Date().getUTCFullYear();
		}
		const end = new Date(Date.UTC(yearNum + 1, 0, 1));

		const [trades, assets] = await Promise.all([
			TradeModel.find({
				userId: objectUserId,
				date: { $lt: end },
			})
				.sort({ date: 1 })
				.lean(),
			(async () => {
				const portfolios = await PortfolioModel.find({ userId: objectUserId })
					.select('_id')
					.lean();
				const portfolioIds = portfolios.map((p: any) => p._id);
				if (!portfolioIds.length) return [];
				return AssetModel.find({ portfolioId: { $in: portfolioIds } }).lean();
			})(),
		]);

		const typeBySymbol: Record<string, string> = {};
		for (const a of assets) {
			typeBySymbol[String(a.symbol || '').toUpperCase()] = String(a.type || '');
		}

		const monthly = this.fiscalService.calculateMonthlyTaxSummary(
			trades.map((t: any) => ({
				assetSymbol: t.symbol,
				side: t.side,
				quantity: t.quantity,
				price: t.price,
				fees: t.fees || 0,
				date: new Date(t.date),
			})),
			typeBySymbol
		).filter((item) => item.year === yearNum);

		const totals = monthly.reduce(
			(acc, m) => {
				acc.stockProfit += m.stockProfit;
				acc.fiiProfit += m.fiiProfit;
				acc.cryptoProfit += m.cryptoProfit;
				acc.taxDue += m.totalTax;
				return acc;
			},
			{ stockProfit: 0, fiiProfit: 0, cryptoProfit: 0, taxDue: 0 }
		);

		return {
			year: yearNum,
			monthly,
			totals,
			guide: [
				'Passo 1: Abra o programa da Receita Federal.',
				'Passo 2: Vá em Bens e Direitos.',
				'Passo 3: Para ações, use Grupo 03 / Código 31.',
				'Passo 4: Para FIIs, use Grupo 07 / Código 03.',
				'Passo 5: Informe posição em 31/12 e custo de aquisição.',
				'Passo 6: Lance dividendos e JCP na ficha Rendimentos.',
			],
		};
	}

	@Post('sale-preview')
	@ApiOperation({ summary: 'Simula venda e imposto estimado' })
	async previewSale(
		@Req() req: any,
		@Body()
		body: {
			symbol: string;
			quantity: number;
			sellPrice: number;
			portfolioId?: string;
		}
	) {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const symbol = String(body.symbol || '').toUpperCase();
		const quantity = Number(body.quantity || 0);
		const sellPrice = Number(body.sellPrice || 0);
		if (!symbol || quantity <= 0 || sellPrice <= 0) {
			return {
				message: 'Parâmetros inválidos',
				symbol,
				quantity,
				sellPrice,
				estimatedTax: 0,
			};
		}

		const assetFilter: any = { symbol };
		const userPortfolios = await PortfolioModel.find({
			userId: new Types.ObjectId(userId),
		})
			.select('_id')
			.lean();
		const allowedPortfolioIds = userPortfolios.map((p: any) => p._id);
		if (!allowedPortfolioIds.length) {
			return {
				symbol,
				quantity,
				sellPrice,
				averagePrice: 0,
				profit: 0,
				estimatedTax: 0,
				exempt: true,
				category: 'stock',
				message: 'Nenhuma carteira encontrada para o usuário.',
			};
		}
		if (body.portfolioId && Types.ObjectId.isValid(body.portfolioId)) {
			const selected = new Types.ObjectId(body.portfolioId);
			const isAllowed = allowedPortfolioIds.some(
				(id: any) => String(id) === String(selected)
			);
			assetFilter.portfolioId = isAllowed
				? selected
				: { $in: allowedPortfolioIds };
		} else {
			assetFilter.portfolioId = { $in: allowedPortfolioIds };
		}

		const asset = await AssetModel.findOne(assetFilter).lean();
		const symbolTradesFilter: any = {
			userId: new Types.ObjectId(userId),
			symbol,
			date: { $lte: new Date() },
		};
		if (assetFilter.portfolioId) {
			symbolTradesFilter.portfolioId = assetFilter.portfolioId;
		}
		const symbolTrades = await TradeModel.find(symbolTradesFilter)
			.sort({ date: 1 })
			.lean();
		const avgResult = this.fiscalService.calculateAveragePrice(
			symbolTrades.map((t: any) => ({
				assetSymbol: t.symbol,
				side: t.side,
				quantity: Number(t.quantity || 0),
				price: Number(t.price || 0),
				fees: Number(t.fees || 0),
				date: new Date(t.date),
			}))
		);
		const avgPrice = Number(avgResult?.averagePrice || asset?.avgPrice || asset?.price || 0);
		const currentQuantity = Number(avgResult?.quantity || asset?.quantity || 0);
		if (currentQuantity <= 0) {
			return {
				symbol,
				quantity,
				sellPrice,
				averagePrice: avgPrice,
				profit: 0,
				estimatedTax: 0,
				exempt: true,
				category: this.fiscalService.getCategoryForAsset(symbol, asset?.type),
				message:
					'Não há posição disponível desse ativo na carteira selecionada para simular venda.',
			};
		}
		if (quantity > currentQuantity) {
			return {
				symbol,
				quantity,
				sellPrice,
				averagePrice: avgPrice,
				profit: 0,
				estimatedTax: 0,
				exempt: true,
				category: this.fiscalService.getCategoryForAsset(symbol, asset?.type),
				message: `Quantidade solicitada (${quantity}) é maior que posição atual (${currentQuantity}).`,
			};
		}
		const totalPortfolioValue = await AssetModel.aggregate([
			{
				$match: {
					portfolioId: { $in: allowedPortfolioIds as any[] },
				},
			},
			{
				$project: {
					value: {
						$multiply: [
							{ $ifNull: ['$quantity', 0] },
							{ $ifNull: ['$currentPrice', '$price'] },
						],
					},
				},
			},
			{
				$group: {
					_id: null,
					total: { $sum: '$value' },
				},
			},
		]);
		const portfolioValue = Number(totalPortfolioValue?.[0]?.total || 0);

		let sector = 'setor não identificado';
		try {
			const quote = await this.stockService.getNationalQuote(symbol, {
				fundamental: true,
				dividends: false,
			});
			sector = quote?.results?.[0]?.sector || sector;
		} catch {
			// best effort
		}

		const now = new Date();
		const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		const monthTrades = await TradeModel.find({
			userId: new Types.ObjectId(userId),
			side: 'sell',
			date: { $gte: startMonth },
		}).lean();
		const monthSymbols = Array.from(
			new Set(monthTrades.map((t: any) => String(t.symbol || '').toUpperCase()))
		);
		const monthAssets = monthSymbols.length
			? await AssetModel.find({
					portfolioId: assetFilter.portfolioId || { $in: allowedPortfolioIds },
					symbol: { $in: monthSymbols },
				})
					.select('symbol type')
					.lean()
			: [];
		const monthTypeBySymbol: Record<string, string> = {};
		for (const monthAsset of monthAssets) {
			monthTypeBySymbol[String(monthAsset.symbol || '').toUpperCase()] = String(
				monthAsset.type || ''
			);
		}

		const monthStockSales = monthTrades.reduce((sum: number, t: any) => {
			const tradeSymbol = String(t.symbol || '').toUpperCase();
			const category = this.fiscalService.getCategoryForAsset(
				tradeSymbol,
				monthTypeBySymbol[tradeSymbol]
			);
			if (category !== 'stock') return sum;
			return sum + Number(t.price || 0) * Number(t.quantity || 0);
		}, 0);

		const preview = this.fiscalService.estimateSaleTax({
			symbol,
			quantity,
			sellPrice,
			averagePrice: avgPrice,
			monthStockSales,
			assetType: asset?.type,
		});
		const soldValue = quantity * sellPrice;
		const portfolioImpactPercent =
			portfolioValue > 0 ? -((soldValue / portfolioValue) * 100) : 0;

		return {
			symbol,
			quantity,
			sellPrice,
			averagePrice: avgPrice,
			currentQuantity,
			remainingQuantity: Number((currentQuantity - quantity).toFixed(8)),
			profit: preview.pnl,
			estimatedTax: preview.tax,
			exempt: preview.exempt,
			category: preview.category,
			stockSalesMonth: preview.stockSalesMonth,
			stockExemptionLimit: preview.stockExemptionLimit,
			sector,
			portfolioValue,
			portfolioImpactPercent,
			message: `Se vender ${symbol} hoje: lucro estimado de R$ ${preview.pnl.toFixed(2)}, imposto estimado de R$ ${preview.tax.toFixed(2)} e impacto na carteira de ${portfolioImpactPercent.toFixed(2)}% (${sector}). ${
				preview.category === 'stock'
					? preview.exempt
						? `Isenção de R$ ${Number(preview.stockExemptionLimit || 20000).toFixed(2)} aplicada no mês (vendas acumuladas: R$ ${Number(preview.stockSalesMonth || 0).toFixed(2)}).`
						: `Limite de isenção mensal excedido (vendas acumuladas: R$ ${Number(preview.stockSalesMonth || 0).toFixed(2)}).`
					: `Categoria fiscal da operação: ${String(preview.category || '').toUpperCase()}.`
			}`,
		};
	}

	@Get('ir-report')
	@ApiOperation({ summary: 'Gera relatório de IR anual (premium)' })
	@ApiQuery({ name: 'year', required: true, example: '2025' })
	@ApiQuery({ name: 'format', required: false, enum: ['json', 'pdf'] })
	async getIrReport(
		@Req() req: any,
		@Query() query: GenerateIrReportDto,
		@Res() res: Response
	) {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const year = Number(query.year);

		const report = await this.irReportService.generateIrReport(userId, year);

		if (query.format === 'pdf') {
			const pdfBuffer = await this.irReportService.generateIrReportPdfBuffer(report);
			res.setHeader('Content-Type', 'application/pdf');
			res.setHeader(
				'Content-Disposition',
				`attachment; filename="ir-report-${year}.pdf"`
			);
			res.setHeader('Content-Length', pdfBuffer.length.toString());
			return res.send(pdfBuffer);
		}

		return res.json(report);
	}
}
