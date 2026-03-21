import {
	ForbiddenException,
	Injectable,
	InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import puppeteer from 'puppeteer';
import { Asset } from 'src/assets/schema/assets.model';
import {
	IrGuideStepDto,
	IrOperationMonthlyItemDto,
	IrPositionItemDto,
	IrProventosItemDto,
	IrReportResponseDto,
} from 'src/fiscal/dto/ir-report-response.dto';
import { TradeDocument, TradeSide } from 'src/fiscal/schema/trade.model';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { SubscriptionService } from 'src/subscription/subscription.service';

interface SymbolPositionState {
	quantity: number;
	totalCost: number;
}

interface MonthlyResultState {
	month: number;
	grossSales: number;
	realizedResult: number;
}

interface TradeLike {
	symbol: string;
	side: TradeSide;
	quantity: number;
	price: number;
	fees?: number;
	date: Date | string;
	provider?: string;
}

@Injectable()
export class IrReportService {
	constructor(
		@InjectModel('Trade')
		private readonly tradeModel: Model<TradeDocument>,
		@InjectModel('Portfolio')
		private readonly portfolioModel: Model<Portfolio>,
		@InjectModel('Asset')
		private readonly assetModel: Model<Asset>,
		private readonly subscriptionService: SubscriptionService
	) {}

	async generateIrReport(
		userId: string,
		year: number
	): Promise<IrReportResponseDto> {
		await this.ensurePremiumAccess(userId);

		const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

		const portfolios = await this.portfolioModel
			.find({ userId: new Types.ObjectId(userId) })
			.select('_id')
			.lean();
		const portfolioIds = portfolios.map((portfolio) => portfolio._id);

		const [allTradesUntilYearEnd, assets] = await Promise.all([
			this.tradeModel
				.find({ userId: new Types.ObjectId(userId), date: { $lte: yearEnd } })
				.sort({ date: 1 })
				.lean(),
			portfolioIds.length
				? this.assetModel.find({ portfolioId: { $in: portfolioIds } }).lean()
				: Promise.resolve([]),
		]);

		const symbolTypeMap = this.buildSymbolTypeMap(assets);

		const positionsBySymbol = new Map<string, SymbolPositionState>();
		const monthlyResults = new Map<number, MonthlyResultState>();
		const monthlyCryptoResults = new Map<number, MonthlyResultState>();

		for (const trade of allTradesUntilYearEnd) {
			this.applyTradeToStates(
				trade,
				year,
				positionsBySymbol,
				monthlyResults,
				monthlyCryptoResults,
				symbolTypeMap
			);
		}

		const positionAtYearEnd = this.normalizePositions(positionsBySymbol);
		const dividends = this.extractProventosByAsset(assets, year);
		const dividendsTotal = this.sumProventos(dividends);
		const jcp: IrProventosItemDto[] = [];
		const jcpTotal = 0;
		const taxableOperations = this.normalizeMonthlyResults(monthlyResults);
		const taxableOperationsTotal = this.sumMonthlyResults(taxableOperations);
		const compensableLosses = taxableOperations.filter(
			(item) => item.realizedResult < 0
		);
		const compensableLossesTotal = compensableLosses.reduce(
			(acc, item) => acc + Math.abs(item.realizedResult),
			0
		);
		const cryptoOperations = this.normalizeMonthlyResults(monthlyCryptoResults);
		const cryptoPositions = positionAtYearEnd.filter((position) =>
			this.isCryptoSymbol(position.symbol, symbolTypeMap)
		);

		return {
			year,
			generatedAt: new Date().toISOString(),
			positionAtYearEnd,
			dividends,
			dividendsTotal,
			jcp,
			jcpTotal,
			taxableOperations,
			taxableOperationsTotal,
			compensableLosses,
			compensableLossesTotal,
			crypto: {
				positions: cryptoPositions,
				operations: cryptoOperations,
				totalRealizedResult: this.sumMonthlyResults(cryptoOperations),
			},
			guide: this.buildGuideSteps(year),
			notes: [
				'Relatório automatizado para apoio à declaração. Revise sempre com sua documentação oficial.',
				'JCP não é identificado de forma automática com os dados atuais; seção preenchida com zero por padrão.',
			],
		};
	}

	async generateIrReportPdfBuffer(
		report: IrReportResponseDto
	): Promise<Buffer> {
		const browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox'],
		});

		try {
			const page = await browser.newPage();
			await page.setContent(this.buildHtmlReport(report), {
				waitUntil: 'networkidle0',
			});
			const pdf = await page.pdf({
				format: 'A4',
				printBackground: true,
				margin: {
					top: '20px',
					right: '20px',
					bottom: '20px',
					left: '20px',
				},
			});

			return Buffer.from(pdf);
		} catch (error) {
			throw new InternalServerErrorException(
				`Erro ao gerar PDF do relatório de IR: ${error.message}`
			);
		} finally {
			await browser.close();
		}
	}

	private async ensurePremiumAccess(userId: string): Promise<void> {
		const subscription =
			await this.subscriptionService.findCurrentSubscriptionByUser(userId);

		if (!subscription) {
			throw new ForbiddenException('FEATURE_PREMIUM_REQUERIDA');
		}

		const planName = ((subscription as any)?.plan?.name || '')
			.toString()
			.toLowerCase();
		const features = Array.isArray((subscription as any)?.plan?.features)
			? (subscription as any).plan.features.map((feature: string) =>
					feature.toLowerCase()
				)
			: [];

		const hasExplicitPremiumFeature = features.some((feature: string) =>
			['premium', 'ir-report', 'imposto-renda', 'fiscal-report'].some(
				(keyword) => feature.includes(keyword)
			)
		);

		const premiumByName =
			planName.includes('premium') || planName.includes('pro');

		if (!hasExplicitPremiumFeature && !premiumByName) {
			throw new ForbiddenException('FEATURE_PREMIUM_REQUERIDA');
		}
	}

	private buildSymbolTypeMap(assets: Asset[]): Map<string, string> {
		const map = new Map<string, string>();

		for (const asset of assets || []) {
			if (!asset.symbol) {
				continue;
			}
			map.set(asset.symbol.toUpperCase(), (asset.type || '').toLowerCase());
		}

		return map;
	}

	private applyTradeToStates(
		trade: TradeLike,
		year: number,
		positionsBySymbol: Map<string, SymbolPositionState>,
		monthlyResults: Map<number, MonthlyResultState>,
		monthlyCryptoResults: Map<number, MonthlyResultState>,
		symbolTypeMap: Map<string, string>
	): void {
		const symbol = (trade.symbol || '').toUpperCase();
		const state = positionsBySymbol.get(symbol) ?? {
			quantity: 0,
			totalCost: 0,
		};
		const quantity = this.safeNumber(trade.quantity);
		const price = this.safeNumber(trade.price);
		const fees = this.safeNumber(trade.fees);

		if (this.normalizeSide(trade.side) === 'buy') {
			state.quantity += quantity;
			state.totalCost += quantity * price + fees;
			positionsBySymbol.set(symbol, state);
			return;
		}

		const averagePrice =
			state.quantity > 0 ? state.totalCost / state.quantity : 0;
		const realizedResult = (price - averagePrice) * quantity - fees;

		state.quantity -= quantity;
		state.totalCost -= averagePrice * quantity;

		if (state.quantity <= 0) {
			state.quantity = 0;
			state.totalCost = 0;
		}

		positionsBySymbol.set(symbol, state);

		const tradeDate = new Date(trade.date);
		if (tradeDate.getUTCFullYear() !== year) {
			return;
		}

		const month = tradeDate.getUTCMonth() + 1;
		if (this.isCryptoSymbol(symbol, symbolTypeMap, trade.provider)) {
			this.accumulateMonthlyResult(
				monthlyCryptoResults,
				month,
				quantity * price,
				realizedResult
			);
		} else {
			this.accumulateMonthlyResult(
				monthlyResults,
				month,
				quantity * price,
				realizedResult
			);
		}
	}

	private normalizeSide(side: TradeSide | string): TradeSide {
		if (String(side).toLowerCase() === 'sell') {
			return 'sell';
		}
		return 'buy';
	}

	private accumulateMonthlyResult(
		state: Map<number, MonthlyResultState>,
		month: number,
		grossSales: number,
		realizedResult: number
	): void {
		const current = state.get(month) ?? {
			month,
			grossSales: 0,
			realizedResult: 0,
		};
		current.grossSales += grossSales;
		current.realizedResult += realizedResult;
		state.set(month, current);
	}

	private normalizePositions(
		positionsBySymbol: Map<string, SymbolPositionState>
	): IrPositionItemDto[] {
		return Array.from(positionsBySymbol.entries())
			.filter(([, state]) => state.quantity > 0)
			.map(([symbol, state]) => {
				const quantity = this.round(state.quantity);
				const averagePrice =
					quantity > 0 ? this.round(state.totalCost / quantity) : 0;
				return {
					symbol,
					quantity,
					averagePrice,
					costBasis: this.round(state.totalCost),
				};
			})
			.sort((a, b) => a.symbol.localeCompare(b.symbol));
	}

	private normalizeMonthlyResults(
		monthlyMap: Map<number, MonthlyResultState>
	): IrOperationMonthlyItemDto[] {
		return Array.from(monthlyMap.values())
			.map((entry) => ({
				month: entry.month,
				grossSales: this.round(entry.grossSales),
				realizedResult: this.round(entry.realizedResult),
			}))
			.sort((a, b) => a.month - b.month);
	}

	private extractProventosByAsset(
		assets: Asset[],
		year: number
	): IrProventosItemDto[] {
		const totalsBySymbol = new Map<string, number>();

		for (const asset of assets || []) {
			const symbol = (asset.symbol || '').toUpperCase();
			const events = Array.isArray(asset.dividendHistory)
				? asset.dividendHistory
				: [];

			if (!symbol || events.length === 0) {
				continue;
			}

			for (const event of events) {
				const eventDate = event?.date ? new Date(event.date) : null;
				const value = this.safeNumber(event?.value);

				if (!eventDate || eventDate.getUTCFullYear() !== year || value <= 0) {
					continue;
				}

				totalsBySymbol.set(symbol, (totalsBySymbol.get(symbol) ?? 0) + value);
			}
		}

		return Array.from(totalsBySymbol.entries())
			.map(([symbol, total]) => ({
				symbol,
				total: this.round(total),
			}))
			.sort((a, b) => a.symbol.localeCompare(b.symbol));
	}

	private sumProventos(items: IrProventosItemDto[]): number {
		return this.round(
			(items || []).reduce((acc, item) => acc + this.safeNumber(item.total), 0)
		);
	}

	private sumMonthlyResults(items: IrOperationMonthlyItemDto[]): number {
		return this.round(
			(items || []).reduce(
				(acc, item) => acc + this.safeNumber(item.realizedResult),
				0
			)
		);
	}

	private isCryptoSymbol(
		symbol: string,
		symbolTypeMap: Map<string, string>,
		provider?: string
	): boolean {
		const type = symbolTypeMap.get((symbol || '').toUpperCase());
		if (type === 'crypto') {
			return true;
		}

		const providerValue = (provider || '').toLowerCase();
		if (providerValue === 'binance' || providerValue === 'bybit') {
			return true;
		}

		return /^[A-Z]{2,10}$/.test(symbol) && !/\d/.test(symbol);
	}

	private buildGuideSteps(year: number): IrGuideStepDto[] {
		return [
			{
				title: '1) Bens e Direitos (ações) - Grupo 03, Código 31',
				details:
					'Informe cada ativo com posição em 31/12/' +
					year +
					' pelo custo de aquisição (não pelo preço de mercado). Use os valores da seção "Posição em 31/12".',
			},
			{
				title: '2) Rendimentos Isentos e Não Tributáveis (dividendos)',
				details:
					'Lance o total anual de dividendos recebido por ativo. Use a seção "Dividendos" como base e valide com informes da corretora.',
			},
			{
				title:
					'3) Rendimentos Sujeitos à Tributação Exclusiva/Definitiva (JCP)',
				details:
					'Com os dados atuais, o sistema preenche JCP com zero por padrão. Se você teve JCP, complemente manualmente com o informe oficial.',
			},
			{
				title: '4) Operações Comuns/Day Trade (Renda Variável)',
				details:
					'Use a seção "Operações tributáveis" para apoiar a apuração mensal de lucro/prejuízo. Prejuízos podem ser compensados em meses futuros.',
			},
			{
				title: '5) Criptoativos - Bens e Direitos e GCAP/IRPF',
				details:
					'Para cripto com saldo em 31/12/' +
					year +
					', preencha em Bens e Direitos conforme natureza do ativo. Use também a seção "Cripto" para apoiar ganho/perda em vendas.',
			},
			{
				title: '6) Conferência final',
				details:
					'Valide tudo com notas de corretagem, extratos e informes de rendimento. Este relatório é de apoio e não substitui conferência contábil.',
			},
		];
	}

	private buildHtmlReport(report: IrReportResponseDto): string {
		const generatedAt = new Date(report.generatedAt).toLocaleString('pt-BR');
		const positionsRows = this.renderRows(
			report.positionAtYearEnd,
			4,
			(item) => `
				<tr>
					<td>${this.escapeHtml(item.symbol)}</td>
					<td>${this.formatNumber(item.quantity)}</td>
					<td>${this.formatCurrency(item.averagePrice)}</td>
					<td>${this.formatCurrency(item.costBasis)}</td>
				</tr>
			`
		);

		const dividendsRows = this.renderRows(
			report.dividends,
			2,
			(item) => `
				<tr>
					<td>${this.escapeHtml(item.symbol)}</td>
					<td>${this.formatCurrency(item.total)}</td>
				</tr>
			`
		);

		const jcpRows = this.renderRows(
			report.jcp,
			2,
			(item) => `
				<tr>
					<td>${this.escapeHtml(item.symbol)}</td>
					<td>${this.formatCurrency(item.total)}</td>
				</tr>
			`
		);

		const taxableRows = this.renderRows(
			report.taxableOperations,
			3,
			(item) => `
				<tr>
					<td>${item.month.toString().padStart(2, '0')}</td>
					<td>${this.formatCurrency(item.grossSales)}</td>
					<td>${this.formatCurrency(item.realizedResult)}</td>
				</tr>
			`
		);

		const lossesRows = this.renderRows(
			report.compensableLosses,
			3,
			(item) => `
				<tr>
					<td>${item.month.toString().padStart(2, '0')}</td>
					<td>${this.formatCurrency(item.grossSales)}</td>
					<td>${this.formatCurrency(item.realizedResult)}</td>
				</tr>
			`
		);

		const cryptoRows = this.renderRows(
			report.crypto.positions,
			4,
			(item) => `
				<tr>
					<td>${this.escapeHtml(item.symbol)}</td>
					<td>${this.formatNumber(item.quantity)}</td>
					<td>${this.formatCurrency(item.averagePrice)}</td>
					<td>${this.formatCurrency(item.costBasis)}</td>
				</tr>
			`
		);

		const cryptoOpsRows = this.renderRows(
			report.crypto.operations,
			3,
			(item) => `
				<tr>
					<td>${item.month.toString().padStart(2, '0')}</td>
					<td>${this.formatCurrency(item.grossSales)}</td>
					<td>${this.formatCurrency(item.realizedResult)}</td>
				</tr>
			`
		);

		const guideRows = this.renderRows(
			report.guide,
			1,
			(step) =>
				`<li><strong>${this.escapeHtml(step.title)}:</strong> ${this.escapeHtml(step.details)}</li>`
		);

		return `
			<!doctype html>
			<html lang="pt-BR">
				<head>
					<meta charset="utf-8" />
					<title>Relatório IR ${report.year}</title>
					<style>
						* { box-sizing: border-box; }
						body { font-family: Arial, sans-serif; color: #0f172a; margin: 20px; background: #f8fafc; }
						h1, h2 { margin: 0; }
						h2 { font-size: 15px; margin-bottom: 10px; }
						p { margin: 0; }
						.hero {
							background: linear-gradient(135deg, #0f172a, #1d4ed8);
							color: #fff;
							border-radius: 14px;
							padding: 18px;
							margin-bottom: 14px;
						}
						.hero h1 { font-size: 24px; margin-bottom: 6px; }
						.hero .sub { color: #dbeafe; font-size: 12px; }
						.summary { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0 14px; }
						.card {
							border: 1px solid #cbd5e1;
							padding: 10px;
							border-radius: 10px;
							background: #ffffff;
						}
						.card span {
							display: block;
							color: #64748b;
							font-size: 10px;
							text-transform: uppercase;
							margin-bottom: 4px;
						}
						.card strong { font-size: 14px; color: #0f172a; }
						.section {
							margin-bottom: 12px;
							background: #ffffff;
							border: 1px solid #e2e8f0;
							border-radius: 12px;
							padding: 12px;
						}
						table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
						th, td { border: 1px solid #e2e8f0; padding: 7px 8px; text-align: left; }
						th {
							background: #f1f5f9;
							color: #334155;
							font-size: 10px;
							text-transform: uppercase;
							letter-spacing: .04em;
						}
						tr:nth-child(even) td { background: #f8fafc; }
						ul { margin: 8px 0 0 18px; padding: 0; }
						li { margin-bottom: 6px; font-size: 11px; line-height: 1.45; }
						.footer {
							margin-top: 10px;
							text-align: right;
							color: #64748b;
							font-size: 10px;
						}
					</style>
				</head>
				<body>
					<div class="hero">
						<h1>Relatório Executivo de Imposto de Renda ${report.year}</h1>
						<p class="sub">Gerado em ${this.escapeHtml(generatedAt)} • Trakker</p>
					</div>

					<div class="summary">
						<div class="card"><span>Dividendos</span><strong>${this.formatCurrency(report.dividendsTotal)}</strong></div>
						<div class="card"><span>JCP</span><strong>${this.formatCurrency(report.jcpTotal)}</strong></div>
						<div class="card"><span>Resultado Tributável</span><strong>${this.formatCurrency(report.taxableOperationsTotal)}</strong></div>
						<div class="card"><span>Prejuízos Compensáveis</span><strong>${this.formatCurrency(report.compensableLossesTotal)}</strong></div>
					</div>

					<div class="section">
						<h2>Posição em 31/12</h2>
						<table>
							<tr><th>Ativo</th><th>Quantidade</th><th>Preço médio</th><th>Custo total</th></tr>
							${positionsRows}
						</table>
					</div>

					<div class="section">
						<h2>Dividendos</h2>
						<table>
							<tr><th>Ativo</th><th>Total</th></tr>
							${dividendsRows}
						</table>
					</div>

					<div class="section">
						<h2>JCP</h2>
						<table>
							<tr><th>Ativo</th><th>Total</th></tr>
							${jcpRows}
						</table>
					</div>

					<div class="section">
						<h2>Operações tributáveis</h2>
						<table>
							<tr><th>Mês</th><th>Vendas brutas</th><th>Resultado</th></tr>
							${taxableRows}
						</table>
					</div>

					<div class="section">
						<h2>Prejuízos compensáveis</h2>
						<table>
							<tr><th>Mês</th><th>Vendas brutas</th><th>Resultado</th></tr>
							${lossesRows}
						</table>
					</div>

					<div class="section">
						<h2>Cripto</h2>
						<p><strong>Resultado total:</strong> ${this.formatCurrency(report.crypto.totalRealizedResult)}</p>
						<table>
							<tr><th>Ativo</th><th>Quantidade</th><th>Preço médio</th><th>Custo total</th></tr>
							${cryptoRows}
						</table>
						<table>
							<tr><th>Mês</th><th>Vendas brutas</th><th>Resultado</th></tr>
							${cryptoOpsRows}
						</table>
					</div>

					<div class="section">
						<h2>Guia mastigado</h2>
						<ul>${guideRows}</ul>
					</div>

					<div class="footer">Documento de apoio para declaração IRPF • Trakker</div>
				</body>
			</html>
		`;
	}

	private renderRows<T>(
		items: T[],
		colspan: number,
		render: (item: T) => string
	): string {
		if (!items || items.length === 0) {
			if (colspan === 1) {
				return '<li>Sem dados no período.</li>';
			}
			return `<tr><td colspan="${colspan}">Sem dados no período.</td></tr>`;
		}
		return items.map(render).join('');
	}

	private formatCurrency(value: number): string {
		return new Intl.NumberFormat('pt-BR', {
			style: 'currency',
			currency: 'BRL',
		}).format(this.safeNumber(value));
	}

	private formatNumber(value: number): string {
		return new Intl.NumberFormat('pt-BR', {
			maximumFractionDigits: 8,
		}).format(this.safeNumber(value));
	}

	private safeNumber(value: unknown): number {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}

	private round(value: number): number {
		return Math.round(this.safeNumber(value) * 100) / 100;
	}

	private escapeHtml(value: string): string {
		return (value || '')
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}
}
