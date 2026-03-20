import {
	Body,
	Controller,
	Delete,
	Get,
	Logger,
	Param,
	Post,
	Req,
	UseGuards,
	UseInterceptors,
	UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Types } from 'mongoose';
import { PDFParse } from 'pdf-parse';
import * as xlsx from 'xlsx';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { BrokerSyncService } from './broker-sync.service';
import { BrokerConnectDto } from './dto/broker-connect.dto';
import { BrokerageNoteUploadModel } from 'src/broker-sync/schema/brokerage-note-upload.model';
import { parseTradesFromCsv } from 'src/fiscal/import/csv-trade-parser';
import { parseTradesFromBtgPdfText } from 'src/fiscal/import/btg-pdf-trade-parser';
import { TradeModel } from 'src/fiscal/schema/trade.model';
import { FiscalService } from 'src/fiscal/fiscal.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { AssetsService } from 'src/assets/assets.service';

type ParsedTrade = {
	assetSymbol: string;
	side: 'buy' | 'sell';
	quantity: number;
	price: number;
	fees?: number;
	date: Date;
};

@Controller('broker-sync')
@UseGuards(JwtAuthGuard)
export class BrokerSyncController {
	private readonly logger = new Logger(BrokerSyncController.name);

	constructor(
		private readonly brokerSyncService: BrokerSyncService,
		private readonly fiscalService: FiscalService,
		private readonly portfolioService: PortfolioService,
		private readonly assetsService: AssetsService
	) {}

	@Get('connections')
	async getConnections(@Req() req: any) {
		return this.brokerSyncService.getConnections(req.user.userId);
	}

	@Post('connect')
	async connect(@Req() req: any, @Body() dto: BrokerConnectDto) {
		return this.brokerSyncService.connect(req.user.userId, dto);
	}

	@Post('sync/:provider')
	async sync(@Req() req: any, @Param('provider') provider: string) {
		return this.brokerSyncService.syncConnection(req.user.userId, provider);
	}

	@Delete('disconnect/:provider')
	async disconnect(@Req() req: any, @Param('provider') provider: string) {
		return this.brokerSyncService.disconnect(req.user.userId, provider);
	}

	@Get('uploads')
	async getUploads(@Req() req: any) {
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		return BrokerageNoteUploadModel.find({
			userId: new Types.ObjectId(userId),
		})
			.sort({ createdAt: -1 })
			.limit(50)
			.lean();
	}

	@Get('upload-note/:uploadId/status')
	async getUploadStatus(@Req() req: any, @Param('uploadId') uploadId: string) {
		if (!Types.ObjectId.isValid(uploadId)) {
			return { message: 'uploadId inválido', status: 'failed' };
		}
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		return BrokerageNoteUploadModel.findOne({
			_id: new Types.ObjectId(uploadId),
			userId: new Types.ObjectId(userId),
		}).lean();
	}

	@Post('upload-note')
	@UseInterceptors(
		FileInterceptor('file', {
			limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
			fileFilter: (_req, file, cb) => {
				const name = String(file.originalname || '').toLowerCase();
				const allowed =
					(file.mimetype || '').includes('csv') ||
					(file.mimetype || '').includes('pdf') ||
					(file.mimetype || '').includes('sheet') ||
					name.endsWith('.csv') ||
					name.endsWith('.pdf') ||
					name.endsWith('.xlsx') ||
					name.endsWith('.xls');
				cb(null, allowed);
			},
		})
	)
	async uploadBrokerageNote(
		@Req() req: any,
		@UploadedFile() file: Express.Multer.File,
		@Body() body: any
	) {
		if (!file) {
			return { message: 'Arquivo não enviado', status: 'failed' };
		}

		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const provider = body?.provider || 'unknown';
		const originalName = String(file.originalname || '').toLowerCase();

		const isCsv =
			(file.mimetype || '').includes('csv') || originalName.endsWith('.csv');
		const isPdf =
			(file.mimetype || '').includes('pdf') || originalName.endsWith('.pdf');
		const isXlsx =
			(file.mimetype || '').includes('sheet') ||
			originalName.endsWith('.xlsx') ||
			originalName.endsWith('.xls');
		const isB3Report =
			originalName.includes('b3') || originalName.includes('relatorio');

		const upload = await BrokerageNoteUploadModel.create({
			userId: new Types.ObjectId(userId),
			provider,
			originalName: file.originalname || '',
			mimeType: file.mimetype,
			size: file.size,
			kind: isB3Report ? 'b3_report' : 'brokerage_note',
			status: 'queued',
		});

		const buffer = Buffer.from((file as any).buffer || '');
		setImmediate(async () => {
			await this.processUploadAsync({
				uploadId: upload._id.toString(),
				userId,
				provider,
				buffer,
				fileName: file.originalname || '',
				isCsv,
				isPdf,
				isXlsx,
				isB3Report,
			});
		});

		return {
			message: 'Arquivo recebido e enfileirado para processamento assíncrono.',
			uploadId: upload._id,
			status: 'queued',
			kind: isB3Report ? 'b3_report' : 'brokerage_note',
		};
	}

	private inferType(symbol: string) {
		if (/^\w{2,10}$/.test(symbol) && !/\d/.test(symbol)) return 'crypto';
		if (/11$/.test(symbol)) return 'fii';
		return 'stock';
	}

	private normalizeNumber(value: unknown): number {
		if (value === null || value === undefined) return 0;
		if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
		const text = String(value).trim();
		if (!text) return 0;
		const normalized = text
			.replace(/\./g, '')
			.replace(',', '.')
			.replace(/[^\d.-]/g, '');
		const parsed = Number(normalized);
		return Number.isFinite(parsed) ? parsed : 0;
	}

	private parseDate(value: unknown): Date | null {
		if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
		if (typeof value === 'number' && value > 0) {
			const excelEpoch = new Date(Date.UTC(1899, 11, 30));
			excelEpoch.setUTCDate(excelEpoch.getUTCDate() + Math.floor(value));
			return Number.isNaN(excelEpoch.getTime()) ? null : excelEpoch;
		}
		const parsed = new Date(String(value || ''));
		if (Number.isNaN(parsed.getTime())) return null;
		return parsed;
	}

	private parseTradesFromXlsx(buffer: Buffer): ParsedTrade[] {
		const workbook = xlsx.read(buffer, { type: 'buffer' });
		const trades: ParsedTrade[] = [];

		for (const sheetName of workbook.SheetNames) {
			const sheet = workbook.Sheets[sheetName];
			if (!sheet) continue;
			const rows = xlsx.utils.sheet_to_json(sheet, { defval: null }) as Record<
				string,
				unknown
			>[];

			for (const row of rows) {
				const symbolRaw =
					row['Código de Negociação'] ||
					row['Código'] ||
					row['Produto'] ||
					row['Ativo'] ||
					row['Ticker'];
				const symbol = String(symbolRaw || '')
					.toUpperCase()
					.trim()
					.match(/[A-Z]{4}\d{1,2}|[A-Z]{2,10}/)?.[0];
				if (!symbol) continue;

				const quantity = this.normalizeNumber(
					row['Quantidade'] || row['Qtde'] || row['quantity']
				);
				if (quantity <= 0) continue;

				let price = this.normalizeNumber(
					row['Preço'] || row['Preço de Fechamento'] || row['price']
				);
				const totalValue = this.normalizeNumber(
					row['Valor'] ||
						row['Valor Atualizado'] ||
						row['Valor Atualizado CURVA'] ||
						row['Valor Atualizado MTM']
				);
				if (price <= 0 && totalValue > 0) {
					price = totalValue / quantity;
				}
				if (price <= 0) continue;

				const sideValue =
					row['C/V'] || row['Tipo'] || row['Compra/Venda'] || row['side'];
				if (!sideValue) continue;
				const sideRaw = String(sideValue).toUpperCase().trim();
				const side: 'buy' | 'sell' =
					sideRaw.startsWith('V') || sideRaw.includes('VENDA') ? 'sell' : 'buy';

				const fees = this.normalizeNumber(
					row['Taxas'] || row['Corretagem'] || row['fees']
				);
				const dateValue = row['Data'] || row['Data Negócio'] || row['date'];
				if (!dateValue) continue;
				const date = this.parseDate(dateValue);
				if (!date) continue;

				trades.push({
					assetSymbol: symbol,
					side,
					quantity,
					price,
					fees,
					date,
				});
			}
		}

		return trades;
	}

	private async processUploadAsync(params: {
		uploadId: string;
		userId: string;
		provider: string;
		buffer: Buffer;
		fileName: string;
		isCsv: boolean;
		isPdf: boolean;
		isXlsx: boolean;
		isB3Report: boolean;
	}) {
		const upload = await BrokerageNoteUploadModel.findById(params.uploadId);
		if (!upload) return;

		try {
			upload.status = 'processing';
			upload.errorMessage = null;
			await upload.save();

			let trades = params.isCsv
				? parseTradesFromCsv(params.buffer.toString('utf8'))
				: [];

			if (params.isPdf) {
				const parser = new PDFParse({ data: params.buffer });
				const parsed = await parser.getText();
				const text = (parsed as any)?.text || (parsed as any)?.document || '';
				await parser.destroy();
				trades = parseTradesFromBtgPdfText(text);
			}

			if (params.isXlsx) {
				trades = this.parseTradesFromXlsx(params.buffer);
			}

			if (!trades.length) {
				upload.status = 'failed';
				upload.errorMessage = params.isB3Report
					? 'Não foi possível extrair operações deste relatório B3 automaticamente. Envie planilha XLSX/CSV para importação completa.'
					: 'Não foi possível extrair operações do arquivo enviado.';
				upload.processedAt = new Date();
				await upload.save();
				return;
			}

			let portfolio = await this.portfolioService.findPortfolioByName(
				params.userId,
				params.provider
			);
			if (!portfolio) {
				portfolio = await this.portfolioService.createPortfolio(params.userId, {
					name: params.provider,
					ownerType: 'self',
					ownerName: 'Brokerage Note Import',
				} as any);
			}

			await TradeModel.insertMany(
				trades.map((t) => ({
					userId: new Types.ObjectId(params.userId),
					portfolioId: new Types.ObjectId(portfolio._id),
					uploadId: new Types.ObjectId(upload._id),
					provider: params.provider,
					symbol: t.assetSymbol,
					side: t.side,
					quantity: t.quantity,
					price: t.price,
					fees: t.fees ?? 0,
					date: t.date,
				}))
			);

			const bySymbol = new Map<string, typeof trades>();
			for (const t of trades) {
				const key = t.assetSymbol;
				const list = bySymbol.get(key) ?? [];
				list.push(t);
				bySymbol.set(key, list);
			}

			let updatedAssets = 0;
			for (const symbol of bySymbol.keys()) {
				const fullSymbolTrades = await TradeModel.find({
					userId: new Types.ObjectId(params.userId),
					portfolioId: new Types.ObjectId(portfolio._id),
					symbol,
				})
					.sort({ date: 1 })
					.lean();
				const result = this.fiscalService.calculateAveragePrice(
					fullSymbolTrades.map((t: any) => ({
						assetSymbol: t.symbol,
						side: t.side,
						quantity: t.quantity,
						price: t.price,
						fees: t.fees,
						date: t.date,
					}))
				);

				const existing = await this.assetsService.findAssetBySymbolAndPortfolio(
					portfolio._id.toString(),
					symbol
				);
				if (existing) {
					await this.assetsService.update(existing._id.toString(), {
						quantity: result.quantity,
						avgPrice: result.averagePrice,
					} as any);
				} else {
					await this.portfolioService.addAssetToPortfolio(portfolio._id.toString(), {
						symbol,
						type: this.inferType(symbol) as any,
						quantity: result.quantity,
						price: Math.max(result.averagePrice || 0.01, 0.01),
					} as any);
					const created = await this.assetsService.findAssetBySymbolAndPortfolio(
						portfolio._id.toString(),
						symbol
					);
					if (created) {
						await this.assetsService.update(created._id.toString(), {
							avgPrice: result.averagePrice,
						} as any);
					}
				}
				updatedAssets++;
			}

			upload.status = 'processed';
			upload.processedAt = new Date();
			upload.stats = {
				tradesImported: trades.length,
				assetsUpdated: updatedAssets,
				portfolioId: String(portfolio._id),
			};
			await upload.save();
		} catch (error) {
			this.logger.error(`Falha no processamento assíncrono: ${error?.message || error}`);
			upload.status = 'failed';
			upload.errorMessage = error?.message || 'Falha ao processar arquivo';
			upload.processedAt = new Date();
			await upload.save();
		}
	}
}
