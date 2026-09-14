import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Asset } from 'src/assets/schema/assets.model';
import { FiscalService } from 'src/fiscal/fiscal.service';
import { TradeDocument } from 'src/fiscal/schema/trade.model';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';
import { PortfolioReturnsService } from 'src/portfolio/returns/portfolio-returns.service';
import { PortfolioRiskContributionService } from 'src/portfolio/risk/portfolio-risk-contribution.service';
import { computeReceivedDividends } from 'src/reports/domain/received-dividends';
import { ReportDocument } from 'src/reports/domain/report-document';
import { REPORT_CATALOG, ReportKind } from 'src/reports/domain/report-catalog';

const MONTHS = [
	'jan',
	'fev',
	'mar',
	'abr',
	'mai',
	'jun',
	'jul',
	'ago',
	'set',
	'out',
	'nov',
	'dez',
];
const TYPE_LABELS: Record<string, string> = {
	stock: 'Ação',
	fii: 'FII',
	etf: 'ETF',
	crypto: 'Cripto',
	fixed_income: 'Renda fixa',
	fund: 'Fundo',
};
const PAYMENT_LABELS: Record<string, string> = {
	DIVIDEND: 'Dividendo',
	JCP: 'JCP',
	RENDIMENTO: 'Rendimento',
	OTHER: 'Outro',
};

const brl = new Intl.NumberFormat('pt-BR', {
	style: 'currency',
	currency: 'BRL',
});
const pct = new Intl.NumberFormat('pt-BR', {
	style: 'percent',
	maximumFractionDigits: 2,
});
const money = (value: number) => brl.format(value);
const fraction = (value: number | null | undefined) =>
	value === null || value === undefined ? '—' : pct.format(value);
const round2 = (value: number) => Math.round(value * 100) / 100;

interface UserData {
	assets: Asset[];
	trades: TradeDocument[];
}

/** Monta o conteúdo de cada relatório a partir dos dados do próprio usuário. */
@Injectable()
export class ReportBuilderService {
	constructor(
		@InjectModel('Trade') private readonly tradeModel: Model<TradeDocument>,
		@InjectModel('Portfolio') private readonly portfolioModel: Model<Portfolio>,
		@InjectModel('Asset') private readonly assetModel: Model<Asset>,
		private readonly fiscalService: FiscalService,
		private readonly returnsService: PortfolioReturnsService,
		private readonly riskContributionService: PortfolioRiskContributionService
	) {}

	async build(
		userId: string,
		kind: Exclude<ReportKind, 'accountant'>,
		year: number
	): Promise<ReportDocument> {
		const generatedAt = new Date().toLocaleString('pt-BR', {
			timeZone: 'America/Sao_Paulo',
		});
		switch (kind) {
			case 'portfolio':
				return this.portfolio(await this.loadUserData(userId), generatedAt);
			case 'income':
				return this.income(await this.loadUserData(userId), year, generatedAt);
			case 'fiscal':
				return this.fiscal(await this.loadUserData(userId), year, generatedAt);
			case 'operations':
				return this.operations(
					await this.loadUserData(userId),
					year,
					generatedAt
				);
			case 'risk':
				return this.risk(userId, generatedAt);
		}
	}

	private async loadUserData(userId: string): Promise<UserData> {
		const objectUserId = new Types.ObjectId(userId);
		const portfolios = await this.portfolioModel
			.find({ userId: objectUserId })
			.select('_id')
			.lean();
		const portfolioIds = portfolios.map((portfolio) => portfolio._id);
		const [assets, trades] = await Promise.all([
			portfolioIds.length
				? this.assetModel
						.find({ portfolioId: { $in: portfolioIds } })
						.lean<Asset[]>()
				: Promise.resolve([] as Asset[]),
			this.tradeModel
				.find({ userId: objectUserId })
				.sort({ date: 1 })
				.lean<TradeDocument[]>(),
		]);
		return { assets, trades };
	}

	private portfolio({ assets }: UserData, generatedAt: string): ReportDocument {
		const positions = assets
			.map((asset) => {
				const quantity = Number(asset.quantity) || 0;
				const avgPrice = Number(asset.avgPrice ?? asset.price) || 0;
				const currentPrice = Number(asset.currentPrice ?? asset.price) || 0;
				return {
					symbol: asset.symbol,
					type: TYPE_LABELS[asset.type] ?? asset.type,
					quantity,
					avgPrice,
					currentPrice,
					value: round2(quantity * currentPrice),
					result: round2(quantity * (currentPrice - avgPrice)),
				};
			})
			.filter((position) => position.quantity > 0)
			.sort((a, b) => b.value - a.value);
		const total = positions.reduce((sum, position) => sum + position.value, 0);
		const cost = positions.reduce(
			(sum, position) => sum + position.quantity * position.avgPrice,
			0
		);

		const byType = new Map<string, number>();
		for (const position of positions) {
			byType.set(
				position.type,
				(byType.get(position.type) ?? 0) + position.value
			);
		}

		return {
			title: REPORT_CATALOG.portfolio.title,
			subtitle: `Posição atual · gerado em ${generatedAt}`,
			summary: [
				{ label: 'Patrimônio', value: money(total) },
				{ label: 'Custo de aquisição', value: money(cost) },
				{ label: 'Resultado', value: money(total - cost) },
				{ label: 'Posições', value: String(positions.length) },
			],
			tables: [
				{
					title: 'Posições',
					columns: [
						{ key: 'symbol', label: 'Ativo', format: 'text' },
						{ key: 'type', label: 'Classe', format: 'text' },
						{ key: 'quantity', label: 'Quantidade', format: 'number' },
						{ key: 'avgPrice', label: 'Preço médio', format: 'currency' },
						{ key: 'currentPrice', label: 'Preço atual', format: 'currency' },
						{ key: 'value', label: 'Valor', format: 'currency' },
						{ key: 'weight', label: 'Peso', format: 'percent' },
						{ key: 'result', label: 'Resultado', format: 'currency' },
					],
					rows: positions.map((position) => ({
						...position,
						weight: total > 0 ? position.value / total : null,
					})),
				},
				{
					title: 'Alocação por classe',
					columns: [
						{ key: 'type', label: 'Classe', format: 'text' },
						{ key: 'value', label: 'Valor', format: 'currency' },
						{ key: 'weight', label: 'Peso', format: 'percent' },
					],
					rows: Array.from(byType.entries())
						.sort((a, b) => b[1] - a[1])
						.map(([type, value]) => ({
							type,
							value: round2(value),
							weight: total > 0 ? value / total : null,
						})),
				},
			],
			notes: ['Valores a preço da última cotação disponível para cada ativo.'],
		};
	}

	private income(
		{ assets, trades }: UserData,
		year: number,
		generatedAt: string
	): ReportDocument {
		const rows = computeReceivedDividends(
			assets.map((asset) => ({
				symbol: asset.symbol,
				quantity: Number(asset.quantity) || 0,
				dividendHistory: asset.dividendHistory,
			})),
			trades.map((trade) => ({
				symbol: trade.symbol,
				side: trade.side,
				quantity: trade.quantity,
				date: trade.date,
			})),
			year
		);
		const total = rows.reduce((sum, row) => sum + row.amount, 0);
		const jcp = rows
			.filter((row) => row.paymentType === 'JCP')
			.reduce((sum, row) => sum + row.amount, 0);

		const bySymbol = new Map<string, { exempt: number; jcp: number }>();
		for (const row of rows) {
			const entry = bySymbol.get(row.symbol) ?? { exempt: 0, jcp: 0 };
			if (row.paymentType === 'JCP') entry.jcp += row.amount;
			else entry.exempt += row.amount;
			bySymbol.set(row.symbol, entry);
		}

		return {
			title: REPORT_CATALOG.income.title,
			subtitle: `Ano-calendário ${year} · gerado em ${generatedAt}`,
			summary: [
				{ label: 'Total recebido', value: money(total) },
				{
					label: 'Isentos (dividendos e rendimentos)',
					value: money(total - jcp),
				},
				{ label: 'JCP (tributação exclusiva)', value: money(jcp) },
			],
			tables: [
				{
					title: 'Proventos por mês',
					columns: [
						{ key: 'month', label: 'Mês', format: 'text' },
						{ key: 'symbol', label: 'Ativo', format: 'text' },
						{ key: 'type', label: 'Tipo', format: 'text' },
						{ key: 'perShare', label: 'Valor por cota', format: 'currency' },
						{ key: 'quantity', label: 'Quantidade', format: 'number' },
						{ key: 'amount', label: 'Recebido', format: 'currency' },
					],
					rows: rows.map((row) => ({
						month: `${MONTHS[row.month - 1]}/${year}`,
						symbol: row.symbol,
						type: PAYMENT_LABELS[row.paymentType] ?? row.paymentType,
						perShare: row.perShare,
						quantity: row.quantity,
						amount: row.amount,
					})),
				},
				{
					title: 'Totais por ativo',
					columns: [
						{ key: 'symbol', label: 'Ativo', format: 'text' },
						{ key: 'exempt', label: 'Isentos', format: 'currency' },
						{ key: 'jcp', label: 'JCP', format: 'currency' },
					],
					rows: Array.from(bySymbol.entries())
						.sort((a, b) => a[0].localeCompare(b[0]))
						.map(([symbol, entry]) => ({
							symbol,
							exempt: round2(entry.exempt),
							jcp: round2(entry.jcp),
						})),
				},
			],
			notes: [
				'Valor recebido = provento por cota × quantidade na data do evento, reconstruída pelas suas negociações.',
				...(rows.some((row) => row.estimated)
					? [
							'Ativos sem negociações importadas usam a quantidade atual: confira com o informe da corretora.',
						]
					: []),
				'Dividendos e rendimentos de FII vão em Rendimentos Isentos; JCP em Tributação Exclusiva.',
			],
		};
	}

	private fiscal(
		{ assets, trades }: UserData,
		year: number,
		generatedAt: string
	): ReportDocument {
		const typeBySymbol: Record<string, string> = {};
		for (const asset of assets)
			typeBySymbol[String(asset.symbol).toUpperCase()] = String(
				asset.type || ''
			);

		const monthly = this.fiscalService
			.calculateMonthlyTaxSummary(
				trades.map((trade) => ({
					assetSymbol: trade.symbol,
					side: trade.side,
					quantity: Number(trade.quantity) || 0,
					price: Number(trade.price) || 0,
					fees: Number(trade.fees) || 0,
					date: new Date(trade.date),
				})),
				typeBySymbol
			)
			.filter((month) => month.year === year);

		const totalTax = monthly.reduce((sum, month) => sum + month.totalTax, 0);
		const result = monthly.reduce(
			(sum, month) =>
				sum + month.stockProfit + month.fiiProfit + month.cryptoProfit,
			0
		);
		const lastCarry = monthly.length
			? monthly[monthly.length - 1].accumulatedLoss
			: 0;

		return {
			title: REPORT_CATALOG.fiscal.title,
			subtitle: `Exercício ${year} · gerado em ${generatedAt}`,
			summary: [
				{ label: 'Resultado líquido', value: money(result) },
				{ label: 'Imposto apurado', value: money(totalTax) },
				{ label: 'Prejuízo a compensar', value: money(lastCarry) },
			],
			tables: [
				{
					title: 'Apuração mês a mês',
					columns: [
						{ key: 'month', label: 'Mês', format: 'text' },
						{ key: 'stockSales', label: 'Vendas ações', format: 'currency' },
						{
							key: 'stockProfit',
							label: 'Resultado ações',
							format: 'currency',
						},
						{ key: 'fiiProfit', label: 'Resultado FIIs', format: 'currency' },
						{
							key: 'cryptoProfit',
							label: 'Resultado cripto',
							format: 'currency',
						},
						{
							key: 'compensated',
							label: 'Prejuízo compensado',
							format: 'currency',
						},
						{
							key: 'accumulatedLoss',
							label: 'Prejuízo acumulado',
							format: 'currency',
						},
						{ key: 'totalTax', label: 'DARF', format: 'currency' },
						{ key: 'status', label: 'Situação', format: 'text' },
					],
					rows: monthly.map((month) => ({
						month: `${MONTHS[month.month - 1]}/${month.year}`,
						stockSales: round2(month.stockSales),
						stockProfit: round2(month.stockProfit),
						fiiProfit: round2(month.fiiProfit),
						cryptoProfit: round2(month.cryptoProfit),
						compensated: round2(month.stockCompensatedLoss),
						accumulatedLoss: round2(month.accumulatedLoss),
						totalTax: round2(month.totalTax),
						status:
							month.totalTax > 0
								? 'A pagar'
								: month.stockProfit + month.fiiProfit + month.cryptoProfit < 0
									? 'Prejuízo'
									: month.stockExempt && month.stockProfit > 0
										? 'Isento'
										: 'Sem imposto',
					})),
				},
			],
			notes: [
				'Preço médio ponderado; isenção de R$ 20 mil em vendas de ações e R$ 35 mil em cripto por mês.',
				'Estimativa baseada nas negociações importadas. Não inclui day trade.',
			],
		};
	}

	private operations(
		{ trades }: UserData,
		year: number,
		generatedAt: string
	): ReportDocument {
		const inYear = trades.filter(
			(trade) => new Date(trade.date).getUTCFullYear() === year
		);
		const bought = inYear
			.filter((t) => t.side === 'buy')
			.reduce((sum, t) => sum + t.quantity * t.price, 0);
		const sold = inYear
			.filter((t) => t.side === 'sell')
			.reduce((sum, t) => sum + t.quantity * t.price, 0);
		const fees = inYear.reduce((sum, t) => sum + (Number(t.fees) || 0), 0);

		return {
			title: REPORT_CATALOG.operations.title,
			subtitle: `Ano ${year} · gerado em ${generatedAt}`,
			summary: [
				{ label: 'Operações', value: String(inYear.length) },
				{ label: 'Compras', value: money(bought) },
				{ label: 'Vendas', value: money(sold) },
				{ label: 'Taxas', value: money(fees) },
			],
			tables: [
				{
					title: 'Operações',
					columns: [
						{ key: 'date', label: 'Data', format: 'date' },
						{ key: 'symbol', label: 'Ativo', format: 'text' },
						{ key: 'side', label: 'Operação', format: 'text' },
						{ key: 'quantity', label: 'Quantidade', format: 'number' },
						{ key: 'price', label: 'Preço', format: 'currency' },
						{ key: 'fees', label: 'Taxas', format: 'currency' },
						{ key: 'total', label: 'Total', format: 'currency' },
						{ key: 'provider', label: 'Origem', format: 'text' },
					],
					rows: inYear.map((trade) => ({
						date: new Date(trade.date).toISOString().slice(0, 10),
						symbol: trade.symbol,
						side: trade.side === 'buy' ? 'Compra' : 'Venda',
						quantity: trade.quantity,
						price: trade.price,
						fees: Number(trade.fees) || 0,
						total: round2(trade.quantity * trade.price),
						provider: trade.provider,
					})),
				},
			],
			notes: [],
		};
	}

	private async risk(
		userId: string,
		generatedAt: string
	): Promise<ReportDocument> {
		const [returns, contribution] = await Promise.all([
			this.returnsService.getReturns(userId),
			this.riskContributionService.getRiskContribution(userId),
		]);
		const { sharpe, valueAtRisk, drawdown } = returns.risk;
		const number = (value: number | null | undefined, digits = 2) =>
			value === null || value === undefined
				? '—'
				: value.toFixed(digits).replace('.', ',');

		return {
			title: REPORT_CATALOG.risk.title,
			subtitle: `${returns.from ?? '—'} a ${returns.to ?? '—'} · gerado em ${generatedAt}`,
			summary: [
				{ label: 'Sharpe (rf = CDI)', value: number(sharpe.sharpe) },
				{
					label: `VaR ${Math.round(valueAtRisk.confidence * 100)}% ${valueAtRisk.horizonDays}d`,
					value: fraction(valueAtRisk.varPct),
				},
				{ label: 'Máx. drawdown', value: fraction(drawdown.maxDrawdown) },
				{
					label: `Beta vs ${returns.benchmark.label}`,
					value: number(returns.benchmark.beta),
				},
			],
			tables: [
				{
					title: 'Métricas',
					columns: [
						{ key: 'metric', label: 'Métrica', format: 'text' },
						{ key: 'value', label: 'Valor', format: 'text' },
					],
					rows: [
						{
							metric: 'Retorno time-weighted',
							value: fraction(returns.twr.value),
						},
						{
							metric: 'Retorno anualizado',
							value: fraction(returns.twr.annualized),
						},
						{ metric: 'Sharpe (rf = CDI)', value: number(sharpe.sharpe) },
						{ metric: 'VaR (perda)', value: fraction(valueAtRisk.varPct) },
						{
							metric: 'VaR em reais',
							value:
								valueAtRisk.amount === null ? '—' : money(valueAtRisk.amount),
						},
						{
							metric: 'CVaR (expected shortfall)',
							value: fraction(valueAtRisk.cvarPct),
						},
						{
							metric: 'Máximo drawdown',
							value: fraction(drawdown.maxDrawdown),
						},
						{
							metric: 'Topo → fundo',
							value: drawdown.peakDate
								? `${drawdown.peakDate} → ${drawdown.troughDate ?? '—'}`
								: '—',
						},
						{
							metric: `Beta vs ${returns.benchmark.label}`,
							value: number(returns.benchmark.beta),
						},
						{
							metric: 'Correlação',
							value: number(returns.benchmark.correlation),
						},
						{
							metric: 'Tracking error',
							value: fraction(returns.benchmark.trackingError),
						},
						{
							metric: 'Volatilidade anualizada',
							value: fraction(contribution.portfolioVolatility),
						},
					],
				},
				{
					title: 'Contribuição de risco por ativo',
					columns: [
						{ key: 'symbol', label: 'Ativo', format: 'text' },
						{ key: 'weight', label: 'Peso', format: 'percent' },
						{ key: 'share', label: 'Fatia do risco', format: 'percent' },
					],
					rows: contribution.rows.map((row) => ({
						symbol: row.symbol,
						weight: row.weightPct / 100,
						share: row.sharePct / 100,
					})),
				},
			],
			notes: [
				'Métricas sobre retornos diários ajustados por aportes e resgates.',
				...(contribution.missingSymbols.length
					? [
							`Sem histórico suficiente para: ${contribution.missingSymbols.join(', ')}.`,
						]
					: []),
			],
		};
	}
}
