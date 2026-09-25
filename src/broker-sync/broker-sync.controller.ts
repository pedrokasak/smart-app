import {
	Body,
	Controller,
	Delete,
	Get,
	Logger,
	NotFoundException,
	Param,
	Post,
	Req,
	UseGuards,
	UseInterceptors,
	UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Types } from 'mongoose';
import { extractPdfText } from 'src/common/pdf/extract-pdf-text';
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
import { validateUploadFile } from 'src/broker-sync/security/upload-file.validator';
import { PortfolioHistoryBackfillService } from 'src/portfolio/history/portfolio-history-backfill.service';
import { RequiresCapability } from 'src/subscription/capabilities/requires-capability.decorator';

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
		private readonly assetsService: AssetsService,
		private readonly portfolioHistoryBackfillService: PortfolioHistoryBackfillService
	) {}

	@Get('connections')
	async getConnections(@Req() req: any) {
		return this.brokerSyncService.getConnections(req.user.userId);
	}

	@RequiresCapability('broker.sync')
	@Post('connect')
	async connect(@Req() req: any, @Body() dto: BrokerConnectDto) {
		return this.brokerSyncService.connect(req.user.userId, dto);
	}

	@RequiresCapability('broker.sync')
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

	/** Dispensa uma linha de "Importações recentes" (só as do próprio usuário). */
	@Delete('uploads/:uploadId')
	async dismissUpload(@Req() req: any, @Param('uploadId') uploadId: string) {
		if (!Types.ObjectId.isValid(uploadId)) {
			throw new NotFoundException('Importação não encontrada.');
		}
		const userId =
			req.user?.userId || req.user?.sub || req.user?._id || req.user?.id;
		const result = await BrokerageNoteUploadModel.deleteOne({
			_id: new Types.ObjectId(uploadId),
			userId: new Types.ObjectId(userId),
		});
		if (!result.deletedCount) {
			throw new NotFoundException('Importação não encontrada.');
		}
		return { dismissed: true };
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
				const mime = String(file.mimetype || '').toLowerCase();
				const allowed =
					mime.includes('csv') ||
					mime.includes('pdf') ||
					mime.includes('sheet') ||
					mime.includes('excel') ||
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
		const buffer = Buffer.from((file as any).buffer || '');
		const validation = validateUploadFile({
			buffer,
			fileName: file.originalname || '',
			mimeType: file.mimetype || '',
		});
		if (!validation.ok) {
			return {
				message:
					validation.reason || 'Arquivo rejeitado por validação de segurança',
				status: 'failed',
			};
		}

		const isCsv = validation.detectedKind === 'csv';
		const isPdf = validation.detectedKind === 'pdf';
		const isXlsx =
			validation.detectedKind === 'xlsx' || validation.detectedKind === 'xls';
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

	/**
	 * Carteira que recebe o que veio de um upload de nota. O nome costumava
	 * ser o slug cru do provider ("b3", "xp") — e `Portfolio.name` exige no
	 * mínimo 3 caracteres, então todo upload de provider com slug curto
	 * falhava com "Portfolio validation failed: name ... shorter than the
	 * minimum allowed length (3)" antes de gravar qualquer coisa. Procura
	 * primeiro pelo nome antigo, pra reaproveitar carteiras de provider com
	 * slug longo que já existem, e só cria com o nome de exibição.
	 */
	private async resolveImportPortfolio(userId: string, provider: string) {
		const displayName = `Carteira ${String(provider || '').toUpperCase()}`;
		const existing =
			(await this.portfolioService.findPortfolioByName(userId, provider)) ||
			(await this.portfolioService.findPortfolioByName(userId, displayName));
		if (existing) return existing;

		return this.portfolioService.createPortfolio(userId, {
			name: displayName,
			ownerType: 'self',
			ownerName: 'Brokerage Note Import',
		} as any);
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
		const text = String(value || '').trim();
		if (!text) return null;
		// B3 exporta datas como DD/MM/AAAA. `new Date(string)` assume o
		// formato americano MM/DD/AAAA: para qualquer dia > 12 isso já
		// retornava Invalid Date (a nota inteira era descartada), e para
		// dia <= 12 invertia mês e dia silenciosamente. Precisa ser
		// interpretado explicitamente antes de cair no parser genérico.
		const brDateMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
		if (brDateMatch) {
			const [, day, month, year] = brDateMatch;
			const date = new Date(
				Date.UTC(Number(year), Number(month) - 1, Number(day))
			);
			return Number.isNaN(date.getTime()) ? null : date;
		}
		const parsed = new Date(text);
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
				const hasExplicitTickerColumn =
					row['Código de Negociação'] !== undefined ||
					row['Código'] !== undefined ||
					row['Ativo'] !== undefined ||
					row['Ticker'] !== undefined;
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
					row['Preço'] ||
						row['Preço unitário'] ||
						row['Preço de Fechamento'] ||
						row['price']
				);
				const totalValue = this.normalizeNumber(
					row['Valor'] ||
						row['Valor da Operação'] ||
						row['Valor Atualizado'] ||
						row['Valor Atualizado CURVA'] ||
						row['Valor Atualizado MTM']
				);
				if (price <= 0 && totalValue > 0) {
					price = totalValue / quantity;
				}
				if (price <= 0) continue;

				// A exportação "Negociação" da B3 usa "Tipo de Movimentação"
				// (não "Tipo") — nunca bate com C/V ou Compra/Venda, que não
				// existem nos relatórios reais da B3. "Movimentação" só é
				// confiável quando a linha também tem um código de ticker
				// explícito: sem isso ela mistura Tesouro Direto e outros
				// eventos cujo "Produto" (ex. "Tesouro IPCA+ 2032") não é um
				// ticker e viraria um ativo inventado no portfólio.
				const sideValue =
					row['C/V'] ||
					row['Tipo de Movimentação'] ||
					(hasExplicitTickerColumn ? row['Movimentação'] : undefined) ||
					row['Tipo'] ||
					row['Compra/Venda'] ||
					row['side'];
				if (!sideValue) continue;
				const sideRaw = String(sideValue).toUpperCase().trim();
				const isBuy = sideRaw === 'COMPRA' || sideRaw === 'C';
				const isSell = sideRaw === 'VENDA' || sideRaw === 'V';
				if (!isBuy && !isSell) {
					// Linha de movimentação que não é compra/venda (dividendo,
					// bonificação, transferência, atualização, etc.) — não é
					// uma negociação e não deve virar trade.
					continue;
				}
				const side: 'buy' | 'sell' = isSell ? 'sell' : 'buy';

				const fees = this.normalizeNumber(
					row['Taxas'] || row['Corretagem'] || row['fees']
				);
				// A exportação "Negociação" da B3 usa "Data do Negócio", não "Data".
				const dateValue =
					row['Data'] ||
					row['Data do Negócio'] ||
					row['Data Negócio'] ||
					row['date'];
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

	// O "Relatório consolidado" da B3 não lista negociações — só a posição
	// atual (planilhas "Posição - Ações/ETF/Fundos"), sem preço de custo.
	// parseTradesFromXlsx sempre retorna 0 trades para esse arquivo, o que é
	// correto; sem este caminho separado, porém, o relatório nunca sincroniza
	// nada, mesmo sendo um dos 3 arquivos que a B3 disponibiliza para o
	// usuário exportar. Aqui a carteira é ajustada direto para a posição
	// informada (melhor aproximação possível sem histórico de negociações).
	private parsePositionsFromXlsx(
		buffer: Buffer
	): { symbol: string; quantity: number; price: number }[] {
		const workbook = xlsx.read(buffer, { type: 'buffer' });
		const positions: { symbol: string; quantity: number; price: number }[] = [];

		for (const sheetName of workbook.SheetNames) {
			if (!sheetName.toLowerCase().startsWith('posição')) continue;
			const sheet = workbook.Sheets[sheetName];
			if (!sheet) continue;
			const rows = xlsx.utils.sheet_to_json(sheet, { defval: null }) as Record<
				string,
				unknown
			>[];

			for (const row of rows) {
				const symbolRaw = row['Código de Negociação'] || row['Código'];
				const symbol = String(symbolRaw || '')
					.toUpperCase()
					.trim()
					.match(/[A-Z]{4}\d{1,2}|[A-Z]{2,10}/)?.[0];
				if (!symbol) continue;

				const quantity = this.normalizeNumber(
					row['Quantidade Disponível'] ?? row['Quantidade']
				);
				if (quantity <= 0) continue;

				const price = this.normalizeNumber(row['Preço de Fechamento']);
				if (price <= 0) continue;

				positions.push({ symbol, quantity, price });
			}
		}

		return positions;
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
		const upload = await BrokerageNoteUploadModel.findOneAndUpdate(
			{
				_id: new Types.ObjectId(params.uploadId),
				status: 'queued',
			},
			{
				$set: {
					status: 'processing',
					errorMessage: null,
				},
			},
			{ new: true }
		);
		if (!upload) return;

		try {
			let trades = params.isCsv
				? parseTradesFromCsv(params.buffer.toString('utf8'))
				: [];

			if (params.isPdf) {
				trades = parseTradesFromBtgPdfText(await extractPdfText(params.buffer));
			}

			if (params.isXlsx) {
				trades = this.parseTradesFromXlsx(params.buffer);
			}

			// O relatório consolidado nunca produz trades (não tem negociações,
			// só posição atual) — cai aqui em vez de "falhou".
			if (!trades.length && params.isXlsx && params.isB3Report) {
				const positions = this.parsePositionsFromXlsx(params.buffer);
				if (positions.length) {
					await this.applyPositionsSnapshot(
						params.userId,
						params.provider,
						positions,
						upload
					);
					return;
				}
			}

			if (!trades.length) {
				upload.status = 'failed';
				upload.errorMessage = params.isB3Report
					? 'Não foi possível extrair operações nem posições deste relatório B3 automaticamente.'
					: 'Não foi possível extrair operações do arquivo enviado.';
				upload.processedAt = new Date();
				await upload.save();
				return;
			}

			const portfolio = await this.resolveImportPortfolio(
				params.userId,
				params.provider
			);

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

			// Histórico diário reconstruído com as operações da nota (TRA-141):
			// sem isso, Sharpe, beta e VaR ficariam indisponíveis por semanas
			// mesmo com um ano de notas importado. Não bloqueia o processamento.
			void this.portfolioHistoryBackfillService
				.backfill({
					userId: params.userId,
					portfolioId: String(portfolio._id),
				})
				.catch((error) =>
					this.logger.warn(
						`Backfill do histórico falhou após importar nota: ${error?.message || error}`
					)
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
					await this.portfolioService.addAssetToPortfolio(
						portfolio._id.toString(),
						{
							symbol,
							type: this.inferType(symbol) as any,
							quantity: result.quantity,
							price: Math.max(result.averagePrice || 0.01, 0.01),
						} as any
					);
					const created =
						await this.assetsService.findAssetBySymbolAndPortfolio(
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
			this.logger.error(
				`Falha no processamento assíncrono: ${error?.message || error}`
			);
			upload.status = 'failed';
			upload.errorMessage = error?.message || 'Falha ao processar arquivo';
			upload.processedAt = new Date();
			await upload.save();
		}
	}

	private async applyPositionsSnapshot(
		userId: string,
		provider: string,
		positions: { symbol: string; quantity: number; price: number }[],
		upload: InstanceType<typeof BrokerageNoteUploadModel>
	) {
		try {
			const portfolio = await this.resolveImportPortfolio(userId, provider);

			let updatedAssets = 0;
			for (const position of positions) {
				const existing = await this.assetsService.findAssetBySymbolAndPortfolio(
					portfolio._id.toString(),
					position.symbol
				);
				if (existing) {
					await this.assetsService.update(existing._id.toString(), {
						quantity: position.quantity,
						avgPrice: position.price,
						price: position.price,
					} as any);
				} else {
					await this.portfolioService.addAssetToPortfolio(
						portfolio._id.toString(),
						{
							symbol: position.symbol,
							type: this.inferType(position.symbol) as any,
							quantity: position.quantity,
							price: position.price,
						} as any
					);
				}
				updatedAssets++;
			}

			upload.status = 'processed';
			upload.processedAt = new Date();
			upload.stats = {
				tradesImported: 0,
				assetsUpdated: updatedAssets,
				portfolioId: String(portfolio._id),
			};
			await upload.save();
		} catch (error) {
			this.logger.error(
				`Falha ao aplicar posições do relatório consolidado: ${error?.message || error}`
			);
			upload.status = 'failed';
			upload.errorMessage =
				error?.message || 'Falha ao processar posições do relatório';
			upload.processedAt = new Date();
			await upload.save();
		}
	}
}
