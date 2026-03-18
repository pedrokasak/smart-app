import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Req,
	UseGuards,
	UseInterceptors,
	UploadedFile,
} from '@nestjs/common';
import { BrokerSyncService } from './broker-sync.service';
import { BrokerConnectDto } from './dto/broker-connect.dto';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { BrokerageNoteUploadModel } from 'src/broker-sync/schema/brokerage-note-upload.model';
import { Types } from 'mongoose';
import { parseTradesFromCsv } from 'src/fiscal/import/csv-trade-parser';
import { parseTradesFromBtgPdfText } from 'src/fiscal/import/btg-pdf-trade-parser';
import { TradeModel } from 'src/fiscal/schema/trade.model';
import { FiscalService } from 'src/fiscal/fiscal.service';
import { PortfolioService } from 'src/portfolio/portfolio.service';
import { AssetsService } from 'src/assets/assets.service';
import { PDFParse } from 'pdf-parse';

@Controller('broker-sync')
@UseGuards(JwtAuthGuard)
export class BrokerSyncController {
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

	@Post('upload-note')
	@UseInterceptors(FileInterceptor('file'))
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

		const originalName = file.originalname || '';
		const isCsv =
			(file.mimetype || '').includes('csv') ||
			originalName.toLowerCase().endsWith('.csv');
		const isPdf =
			(file.mimetype || '').includes('pdf') ||
			originalName.toLowerCase().endsWith('.pdf');

		const doc = await BrokerageNoteUploadModel.create({
			userId: new Types.ObjectId(userId),
			provider,
			originalName,
			mimeType: file.mimetype,
			size: file.size,
			status: 'queued',
		});

		if (!isCsv && !isPdf) {
			return {
				message:
					'Nota recebida. No MVP o processamento automático está habilitado para CSV (padrão) e PDF do BTG.',
				uploadId: doc._id,
				status: doc.status,
			};
		}

		let trades = isCsv
			? parseTradesFromCsv(
					Buffer.from((file as any).buffer || '').toString('utf8')
				)
			: [];

		if (isPdf) {
			// PDF: implementado inicialmente para layout BTG (negócios realizados)
			const parser = new PDFParse({
				data: Buffer.from((file as any).buffer || ''),
			});
			const parsed = await parser.getText();
			const text = (parsed as any)?.text || (parsed as any)?.document || '';
			trades = parseTradesFromBtgPdfText(text);
			await parser.destroy();
		}

		if (!trades.length) {
			doc.status = 'failed';
			await doc.save();
			return {
				message: isCsv
					? 'CSV recebido, mas não consegui extrair operações. Use colunas: date,symbol,side,quantity,price,fees (ou equivalentes em PT).'
					: 'PDF recebido, mas não consegui extrair operações. No momento o parser está ajustado para a nota do BTG (seção “Negócios realizados”).',
				uploadId: doc._id,
				status: doc.status,
			};
		}

		// Portfólio por provider (ex.: xp, btg, clear, etc.)
		let portfolio = await this.portfolioService.findPortfolioByName(
			userId,
			provider
		);
		if (!portfolio) {
			portfolio = await this.portfolioService.createPortfolio(userId, {
				name: provider,
				ownerType: 'self',
				ownerName: 'Brokerage Note Import',
			} as any);
		}

		// Persist trades
		await TradeModel.insertMany(
			trades.map((t) => ({
				userId: new Types.ObjectId(userId),
				portfolioId: new Types.ObjectId(portfolio._id),
				uploadId: new Types.ObjectId(doc._id),
				provider,
				symbol: t.assetSymbol,
				side: t.side,
				quantity: t.quantity,
				price: t.price,
				fees: t.fees ?? 0,
				date: t.date,
			}))
		);

		// Agrupa por ativo e recalcula PM/posição
		const bySymbol = new Map<string, typeof trades>();
		for (const t of trades) {
			const key = t.assetSymbol;
			const list = bySymbol.get(key) ?? [];
			list.push(t);
			bySymbol.set(key, list);
		}

		const inferType = (symbol: string) => {
			if (/^\w{2,10}$/.test(symbol) && !/\d/.test(symbol)) return 'crypto';
			if (/11$/.test(symbol)) return 'fii';
			return 'stock';
		};

		let updatedAssets = 0;
		for (const [symbol, symbolTrades] of bySymbol.entries()) {
			const result = this.fiscalService.calculateAveragePrice(
				symbolTrades.map((t) => ({
					assetSymbol: t.assetSymbol,
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
				// Create requires price; we store cost also in avgPrice
				await this.portfolioService.addAssetToPortfolio(
					portfolio._id.toString(),
					{
						symbol,
						type: inferType(symbol) as any,
						quantity: result.quantity,
						price: Math.max(result.averagePrice || 0.01, 0.01),
					} as any
				);
				// Ensure avgPrice is stored even for new assets
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

		doc.status = 'processed';
		await doc.save();

		return {
			message:
				'CSV processado: operações importadas, preço médio/posição calculados e carteira atualizada.',
			uploadId: doc._id,
			status: doc.status,
			tradesImported: trades.length,
			assetsUpdated: updatedAssets,
			portfolioId: portfolio._id,
		};
	}
}
