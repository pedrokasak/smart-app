import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import puppeteer from 'puppeteer';
import { Asset } from 'src/assets/schema/assets.model';
import { FiscalService } from 'src/fiscal/fiscal.service';
import { TradeDocument } from 'src/fiscal/schema/trade.model';
import { Portfolio } from 'src/portfolio/schema/portfolio.model';

type ReportType = 'fiscal' | 'transactions' | 'assets';

@Injectable()
export class PortfolioReportService {
	constructor(
		@InjectModel('Trade')
		private readonly tradeModel: Model<TradeDocument>,
		@InjectModel('Portfolio')
		private readonly portfolioModel: Model<Portfolio>,
		@InjectModel('Asset')
		private readonly assetModel: Model<Asset>,
		private readonly fiscalService: FiscalService
	) {}

	private formatBRL(value: number): string {
		return new Intl.NumberFormat('pt-BR', {
			style: 'currency',
			currency: 'BRL',
		}).format(Number(value || 0));
	}

	private escapeHtml(value: unknown): string {
		return String(value ?? '')
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	}

	private formatNumber(value: number): string {
		return new Intl.NumberFormat('pt-BR', {
			maximumFractionDigits: 8,
		}).format(Number(value || 0));
	}

	private fieldLabel(field: string): string {
		const labels: Record<string, string> = {
			symbol: 'Ativo',
			type: 'Tipo',
			quantity: 'Quantidade',
			avgPrice: 'Preço Médio',
			currentPrice: 'Preço Atual',
			value: 'Valor',
			date: 'Data',
			side: 'Operação',
			price: 'Preço',
			fees: 'Taxas',
			total: 'Total',
			month: 'Mês',
			grossSales: 'Vendas Brutas',
			realizedResult: 'Resultado Realizado',
			stockSales: 'Vendas Ações',
			stockProfit: 'Lucro/Prejuízo Ações',
			fiiProfit: 'Lucro/Prejuízo FIIs',
			cryptoProfit: 'Lucro/Prejuízo Cripto',
			stockTax: 'Imposto Ações',
			fiiTax: 'Imposto FIIs',
			cryptoTax: 'Imposto Cripto',
			totalTax: 'Imposto Total',
			stockExempt: 'Isenção 20k',
		};
		return labels[field] || field;
	}

	private formatCell(field: string, value: unknown): string {
		if (field === 'side') {
			const v = String(value || '').toLowerCase();
			return v === 'buy' ? 'Compra' : v === 'sell' ? 'Venda' : String(value || '');
		}
		if (field === 'month') {
			return String(value || '').padStart(2, '0');
		}
		if (field === 'stockExempt') {
			return value ? 'Sim' : 'Não';
		}
		if (typeof value === 'number') {
			const currencyFields = new Set([
				'avgPrice',
				'currentPrice',
				'value',
				'price',
				'fees',
				'total',
				'grossSales',
				'realizedResult',
				'stockSales',
				'stockProfit',
				'fiiProfit',
				'cryptoProfit',
				'stockTax',
				'fiiTax',
				'cryptoTax',
				'totalTax',
			]);
			if (currencyFields.has(field)) return this.formatBRL(value);
			return this.formatNumber(value);
		}
		return String(value ?? '');
	}

	private async getUserPortfolioIds(userId: string) {
		const portfolios = await this.portfolioModel
			.find({ userId: new Types.ObjectId(userId) })
			.select('_id')
			.lean();
		return portfolios.map((p: any) => p._id);
	}

	async buildReportData(userId: string, type: ReportType, year?: number) {
		const portfolioIds = await this.getUserPortfolioIds(userId);
		const yearNum = year || new Date().getFullYear();
		const start = new Date(Date.UTC(yearNum, 0, 1));
		const end = new Date(Date.UTC(yearNum + 1, 0, 1));

		if (type === 'assets') {
			const assets = await this.assetModel
				.find({ portfolioId: { $in: portfolioIds } })
				.sort({ symbol: 1 })
				.lean();
			const totalValue = assets.reduce(
				(sum: number, a: any) =>
					sum + Number(a.quantity || 0) * Number(a.currentPrice || a.price || 0),
				0
			);
			return {
				type,
				title: 'Relatório de Ativos',
				year: yearNum,
				totals: { totalValue, totalAssets: assets.length },
				items: assets.map((a: any) => ({
					symbol: a.symbol,
					type: a.type,
					quantity: Number(a.quantity || 0),
					avgPrice: Number(a.avgPrice || a.price || 0),
					currentPrice: Number(a.currentPrice || a.price || 0),
					value:
						Number(a.quantity || 0) * Number(a.currentPrice || a.price || 0),
				})),
			};
		}

		const trades = await this.tradeModel
			.find({
				userId: new Types.ObjectId(userId),
				...(type === 'transactions' || type === 'fiscal'
					? { date: { $gte: start, $lt: end } }
					: {}),
			})
			.sort({ date: 1 })
			.lean();

		if (type === 'transactions') {
			const gross = trades.reduce(
				(sum: number, t: any) => sum + Number(t.price || 0) * Number(t.quantity || 0),
				0
			);
			return {
				type,
				title: 'Relatório de Transações',
				year: yearNum,
				totals: { totalTransactions: trades.length, gross },
				items: trades.map((t: any) => ({
					date: new Date(t.date).toISOString().slice(0, 10),
					symbol: t.symbol,
					side: t.side,
					quantity: Number(t.quantity || 0),
					price: Number(t.price || 0),
					fees: Number(t.fees || 0),
					total: Number(t.quantity || 0) * Number(t.price || 0),
				})),
			};
		}

		const assets = await this.assetModel
			.find({ portfolioId: { $in: portfolioIds } })
			.select('symbol type')
			.lean();
		const typeBySymbol: Record<string, string> = {};
		for (const asset of assets) {
			typeBySymbol[String((asset as any).symbol || '').toUpperCase()] = String(
				(asset as any).type || ''
			);
		}

		const monthly = this.fiscalService.calculateMonthlyTaxSummary(
			trades.map((t: any) => ({
				assetSymbol: t.symbol,
				side: t.side,
				quantity: Number(t.quantity || 0),
				price: Number(t.price || 0),
				fees: Number(t.fees || 0),
				date: new Date(t.date),
			})),
			typeBySymbol
		);

		const totals = monthly.reduce(
			(acc, m) => {
				acc.stockProfit += m.stockProfit;
				acc.fiiProfit += m.fiiProfit;
				acc.cryptoProfit += m.cryptoProfit;
				acc.totalTax += m.totalTax;
				return acc;
			},
			{ stockProfit: 0, fiiProfit: 0, cryptoProfit: 0, totalTax: 0 }
		);

		return {
			type,
			title: 'Relatório Fiscal',
			year: yearNum,
			totals,
			items: monthly,
		};
	}

	private renderHtml(data: any): string {
		const subtitle = `Ano-base ${data.year} • Gerado em ${new Date().toLocaleString('pt-BR')}`;

		const totalsBlock = Object.entries(data.totals || {})
			.map(
				([k, v]) =>
					`<div class="chip"><span>${this.escapeHtml(this.fieldLabel(k))}</span><strong>${typeof v === 'number' ? this.escapeHtml(this.formatCell(k, v)) : this.escapeHtml(String(v))}</strong></div>`
			)
			.join('');

		const rows = (data.items || [])
			.map((item: any) => {
				const entries = Object.entries(item);
				const cells = entries
					.map(([field, value]) => {
						return `<td>${this.escapeHtml(this.formatCell(field, value))}</td>`;
					})
					.join('');
				return `<tr>${cells}</tr>`;
			})
			.join('');

		const headers =
			data.items && data.items.length
				? Object.keys(data.items[0])
						.map((h: string) => `<th>${this.escapeHtml(this.fieldLabel(h))}</th>`)
						.join('')
				: '';

		return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #0f172a; background: #f8fafc; }
    .hero { background: linear-gradient(135deg, #0f172a, #1d4ed8); color: white; border-radius: 14px; padding: 18px; margin-bottom: 14px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .sub { color: #dbeafe; font-size: 12px; }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 18px; }
    .chip { border: 1px solid #cbd5e1; border-radius: 10px; padding: 8px 10px; min-width: 170px; background: #ffffff; }
    .chip span { display: block; color: #64748b; font-size: 11px; text-transform: uppercase; margin-bottom: 4px; }
    .chip strong { font-size: 14px; color: #0f172a; }
    .section { background: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; padding: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #e2e8f0; padding: 7px 8px; text-align: left; }
    th { background: #f1f5f9; color: #334155; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    tr:nth-child(even) td { background: #f8fafc; }
    .footer { margin-top: 12px; color: #64748b; font-size: 10px; text-align: right; }
  </style>
</head>
<body>
  <div class="hero">
    <h1>${this.escapeHtml(data.title)}</h1>
    <div class="sub">${this.escapeHtml(subtitle)}</div>
  </div>
  <div class="chips">${totalsBlock}</div>
  <div class="section">
    <table>
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div class="footer">Trakker • Relatório Executivo</div>
</body>
</html>`;
	}

	async renderPdf(data: any): Promise<Buffer> {
		const browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox', '--disable-setuid-sandbox'],
		});
		try {
			const page = await browser.newPage();
			await page.setContent(this.renderHtml(data), { waitUntil: 'networkidle0' });
			const pdf = await page.pdf({
				format: 'A4',
				printBackground: true,
				margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' },
			});
			return Buffer.from(pdf);
		} finally {
			await browser.close();
		}
	}
}
