import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	ParseUUIDPipe,
	Post,
	Put,
	Query,
	Req,
	UploadedFile,
	UseFilters,
	UseGuards,
	UseInterceptors,
	applyDecorators,
} from '@nestjs/common';
import {
	ApiBearerAuth,
	ApiBody,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from '@nestjs/swagger';
import { AllocationTargetService } from 'src/advisor/application/allocation-target.service';
import { ClientDirectoryService } from 'src/advisor/application/client-directory.service';
import { CsvImportService } from 'src/advisor/application/csv/csv-import.service';
import { PortfolioMetricsService } from 'src/advisor/application/metrics/portfolio-metrics.service';
import { SharedPortfolioService } from 'src/advisor/application/shared-portfolio.service';
import { TransactionService } from 'src/advisor/application/transaction.service';
import { NoStoreInterceptor } from 'src/advisor/interface/no-store.interceptor';
import { OrgContextGuard } from 'src/advisor/interface/org-context.guard';
import { JwtAuthGuard } from 'src/authentication/jwt-auth.guard';
import { AdvisorBffExceptionFilter } from './advisor-bff-exception.filter';
import { AdvisorPortalGuard } from './advisor-portal.guard';
import { CsvUpload, csvTextOf } from './csv-upload';
import {
	AllocationTargetResponseDto,
	SetAllocationTargetDto,
} from './dto/allocation-target.dto';
import {
	ClientPageResponseDto,
	ClientSummaryResponseDto,
	CreateClientDto,
	DEFAULT_PAGE_LIMIT,
	ListClientsQueryDto,
	PageQueryDto,
} from './dto/client.dto';
import { ClientDetailResponseDto } from './dto/client-detail.dto';
import { ErrorResponseDto } from './dto/error-response.dto';
import {
	ImportCsvBodyDto,
	ImportResponseDto,
	RevertImportResponseDto,
} from './dto/import.dto';
import { MetricsResponseDto } from './dto/metrics.dto';
import {
	SharedPortfolioMetricsResponseDto,
	SharedPortfolioResponseDto,
} from './dto/shared-portfolio.dto';
import {
	CreateTransactionDto,
	PositionsResponseDto,
	TransactionPageResponseDto,
	TransactionResponseDto,
} from './dto/transaction.dto';
import { pageLedger } from './ledger-page';
import { accessContextOf } from './request-context';
import { WealthSummaryAssembler } from './wealth-summary.assembler';

/** Erros comuns às rotas de cliente (§5.3 do spec). */
function ApiClientErrors(options: { validation?: string } = {}) {
	return applyDecorators(
		ApiResponse({
			status: 400,
			type: ErrorResponseDto,
			description:
				options.validation ??
				'Parâmetro ou corpo inválido (id fora do formato)',
		}),
		ApiResponse({
			status: 403,
			type: ErrorResponseDto,
			description:
				'Sem acesso ao portal, org inválida ou ACTION_FORBIDDEN (cliente criado pelo investidor não aceita lançamento) ou VERIFIED_IMMUTABLE (lançamento importado não se remove; desfaça o import)',
		}),
		ApiResponse({
			status: 404,
			type: ErrorResponseDto,
			description: 'Cliente, lançamento ou lote inexistente ou de outra org',
		})
	);
}

const UNPROCESSABLE = (description: string) =>
	ApiResponse({ status: 422, type: ErrorResponseDto, description });

/**
 * Clientes da org ativa: diretório, livro, import, meta, métricas e carteira
 * compartilhada. Só traduz HTTP; cada serviço decide o acesso pelo
 * `ensureCanAccessClient` e audita. O dado B2C é só leitura.
 */
@Controller('advisor/v1/clients')
@ApiTags('advisor-bff')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, AdvisorPortalGuard, OrgContextGuard)
@UseFilters(AdvisorBffExceptionFilter)
@UseInterceptors(NoStoreInterceptor)
export class ClientsController {
	constructor(
		private readonly directory: ClientDirectoryService,
		private readonly transactions: TransactionService,
		private readonly imports: CsvImportService,
		private readonly targets: AllocationTargetService,
		private readonly metrics: PortfolioMetricsService,
		private readonly shared: SharedPortfolioService,
		private readonly wealth: WealthSummaryAssembler
	) {}

	@Get()
	@ApiOperation({ summary: 'Lista os clientes da organização' })
	@ApiResponse({ status: 200, type: ClientPageResponseDto })
	@ApiClientErrors({ validation: 'status, cursor (INVALID_CURSOR) ou limit' })
	async list(
		@Req() req: any,
		@Query() query: ListClientsQueryDto
	): Promise<ClientPageResponseDto> {
		const page = await this.directory.listClients(accessContextOf(req), {
			status: query.status ?? 'OPEN',
			cursor: query.cursor,
			limit: query.limit ?? DEFAULT_PAGE_LIMIT,
		});
		return ClientPageResponseDto.of(page);
	}

	@Post()
	@ApiOperation({ summary: 'Cria um cliente (ADVISOR_CREATED) na org' })
	@ApiResponse({ status: 201, type: ClientSummaryResponseDto })
	@ApiClientErrors({ validation: 'INVALID_NAME ou corpo inválido' })
	async create(
		@Req() req: any,
		@Body() body: CreateClientDto
	): Promise<ClientSummaryResponseDto> {
		const created = await this.directory.createClient(accessContextOf(req), {
			name: body.name,
		});
		return ClientSummaryResponseDto.of(created);
	}

	@Get(':clientId')
	@ApiOperation({
		summary: 'Cliente com o patrimônio somado, uma parte por origem',
	})
	@ApiResponse({ status: 200, type: ClientDetailResponseDto })
	@ApiClientErrors()
	async detail(
		@Req() req: any,
		@Param('clientId', new ParseUUIDPipe()) clientId: string
	): Promise<ClientDetailResponseDto> {
		const ctx = accessContextOf(req);
		const client = await this.directory.getClient(ctx, clientId);
		const wealth = await this.wealth.build(ctx, client);
		return ClientDetailResponseDto.detailOf(client, wealth);
	}

	@Get(':clientId/transactions')
	@ApiOperation({ summary: 'Livro de transações lançado pelo assessor' })
	@ApiResponse({ status: 200, type: TransactionPageResponseDto })
	@ApiClientErrors({ validation: 'cursor (INVALID_CURSOR) ou limit' })
	async listTransactions(
		@Req() req: any,
		@Param('clientId', new ParseUUIDPipe()) clientId: string,
		@Query() query: PageQueryDto
	): Promise<TransactionPageResponseDto> {
		const ledger = await this.transactions.listTransactions(
			accessContextOf(req),
			clientId
		);
		const page = pageLedger(ledger, {
			cursor: query.cursor,
			limit: query.limit ?? DEFAULT_PAGE_LIMIT,
		});
		return {
			items: page.items.map(TransactionResponseDto.of),
			nextCursor: page.nextCursor,
		};
	}

	@Post(':clientId/transactions')
	@ApiOperation({ summary: 'Lançamento manual' })
	@ApiResponse({ status: 201, type: TransactionResponseDto })
	@ApiClientErrors()
	@UNPROCESSABLE(
		'INVALID_TRANSACTION (details.errors) ou OVERSELL (details.symbol, details.tradeDate)'
	)
	async addTransaction(
		@Req() req: any,
		@Param('clientId', new ParseUUIDPipe()) clientId: string,
		@Body() body: CreateTransactionDto
	): Promise<TransactionResponseDto> {
		const created = await this.transactions.addManual(
			accessContextOf(req),
			clientId,
			{
				symbol: body.symbol,
				assetClass: body.assetClass,
				side: body.side,
				quantity: body.quantity,
				unitPriceMinor: body.unitPriceMinor,
				feesMinor: body.feesMinor,
				currency: body.currency,
				tradeDate: body.tradeDate,
				...(body.liquidityDays !== undefined && {
					liquidityDays: body.liquidityDays,
				}),
			}
		);
		return TransactionResponseDto.of(created);
	}

	@Delete(':clientId/transactions/:transactionId')
	@HttpCode(HttpStatus.NO_CONTENT)
	@ApiOperation({ summary: 'Remove um lançamento manual' })
	@ApiResponse({ status: 204 })
	@ApiClientErrors()
	@UNPROCESSABLE('OVERSELL: remover deixaria uma venda sem saldo')
	async removeTransaction(
		@Req() req: any,
		@Param('clientId', new ParseUUIDPipe()) clientId: string,
		@Param('transactionId', new ParseUUIDPipe()) transactionId: string
	): Promise<void> {
		await this.transactions.removeManual(
			accessContextOf(req),
			clientId,
			transactionId
		);
	}

	@Get(':clientId/positions')
	@ApiOperation({ summary: 'Posições da carteira lançada pelo assessor' })
	@ApiResponse({ status: 200, type: PositionsResponseDto })
	@ApiClientErrors()
	async positions(
		@Req() req: any,
		@Param('clientId', new ParseUUIDPipe()) clientId: string
	): Promise<PositionsResponseDto> {
		const derived = await this.transactions.getPositions(
			accessContextOf(req),
			clientId
		);
		return PositionsResponseDto.of(derived);
	}

	@Post(':clientId/imports')
	@CsvUpload()
	@ApiOperation({ summary: 'Importa um CSV de transações' })
	@ApiBody({ type: ImportCsvBodyDto })
	@ApiResponse({ status: 201, type: ImportResponseDto })
	@ApiClientErrors({ validation: 'FILE_REQUIRED ou id fora do formato' })
	@ApiResponse({
		status: 409,
		type: ErrorResponseDto,
		description: 'DUPLICATE_IMPORT: o mesmo arquivo já foi importado',
	})
	@ApiResponse({
		status: 413,
		type: ErrorResponseDto,
		description: 'FILE_TOO_LARGE (acima de 1 MB)',
	})
	@ApiResponse({
		status: 415,
		type: ErrorResponseDto,
		description: 'UNSUPPORTED_FILE_TYPE (só text/csv e text/plain)',
	})
	@UNPROCESSABLE('CSV_REJECTED: details.errors com as linhas { line, code }')
	@ApiResponse({
		status: 429,
		type: ErrorResponseDto,
		description: 'Limite de 20 imports por 10 minutos por conta e por IP',
	})
	async importCsv(
		@Req() req: any,
		@Param('clientId', new ParseUUIDPipe()) clientId: string,
		@UploadedFile() file?: { buffer?: Buffer }
	): Promise<ImportResponseDto> {
		const result = await this.imports.importCsv(
			accessContextOf(req),
			clientId,
			csvTextOf(file)
		);
		return {
			importBatchId: result.importBatchId,
			imported: result.imported,
		};
	}

	@Delete(':clientId/imports/:importBatchId')
	@ApiOperation({ summary: 'Desfaz um import' })
	@ApiResponse({ status: 200, type: RevertImportResponseDto })
	@ApiClientErrors()
	@UNPROCESSABLE('OVERSELL: desfazer deixaria uma venda sem saldo')
	async revertImport(
		@Req() req: any,
		@Param('clientId', new ParseUUIDPipe()) clientId: string,
		@Param('importBatchId', new ParseUUIDPipe()) importBatchId: string
	): Promise<RevertImportResponseDto> {
		const result = await this.imports.revertImport(
			accessContextOf(req),
			clientId,
			importBatchId
		);
		return { removed: result.removed };
	}

	@Get(':clientId/allocation-target')
	@ApiOperation({ summary: 'Meta de alocação (nula se ainda não definida)' })
	@ApiResponse({ status: 200, type: AllocationTargetResponseDto })
	@ApiClientErrors()
	async getTarget(
		@Req() req: any,
		@Param('clientId', new ParseUUIDPipe()) clientId: string
	): Promise<AllocationTargetResponseDto> {
		const target = await this.targets.getTarget(accessContextOf(req), clientId);
		return AllocationTargetResponseDto.of(target);
	}

	@Put(':clientId/allocation-target')
	@ApiOperation({ summary: 'Define a meta de alocação' })
	@ApiResponse({ status: 200, type: AllocationTargetResponseDto })
	@ApiClientErrors()
	@UNPROCESSABLE(
		'reason EMPTY_TARGET, UNKNOWN_ASSET_CLASS, INVALID_VALUE, VALUE_OUT_OF_RANGE ou SUM_NOT_100'
	)
	async setTarget(
		@Req() req: any,
		@Param('clientId', new ParseUUIDPipe()) clientId: string,
		@Body() body: SetAllocationTargetDto
	): Promise<AllocationTargetResponseDto> {
		const target = await this.targets.setTarget(
			accessContextOf(req),
			clientId,
			body.targets
		);
		return AllocationTargetResponseDto.of(target);
	}

	@Get(':clientId/metrics')
	@ApiOperation({ summary: 'Métricas da carteira lançada pelo assessor' })
	@ApiResponse({ status: 200, type: MetricsResponseDto })
	@ApiClientErrors()
	async getMetrics(
		@Req() req: any,
		@Param('clientId', new ParseUUIDPipe()) clientId: string
	): Promise<MetricsResponseDto> {
		const metrics = await this.metrics.getMetrics(
			accessContextOf(req),
			clientId
		);
		return MetricsResponseDto.of(metrics);
	}

	@Get(':clientId/shared-portfolios')
	@ApiOperation({ summary: 'Carteiras que o cliente compartilhou (leitura)' })
	@ApiResponse({ status: 200, type: [SharedPortfolioResponseDto] })
	@ApiClientErrors()
	async listShared(
		@Req() req: any,
		@Param('clientId', new ParseUUIDPipe()) clientId: string
	): Promise<SharedPortfolioResponseDto[]> {
		const portfolios = await this.shared.listSharedPortfolios(
			accessContextOf(req),
			clientId
		);
		return portfolios.map(SharedPortfolioResponseDto.of);
	}

	@Get(':clientId/shared-portfolios/metrics')
	@ApiOperation({ summary: 'Métricas das carteiras compartilhadas' })
	@ApiResponse({ status: 200, type: [SharedPortfolioMetricsResponseDto] })
	@ApiClientErrors()
	async sharedMetrics(
		@Req() req: any,
		@Param('clientId', new ParseUUIDPipe()) clientId: string
	): Promise<SharedPortfolioMetricsResponseDto[]> {
		const items = await this.shared.getSharedMetrics(
			accessContextOf(req),
			clientId
		);
		return items.map(SharedPortfolioMetricsResponseDto.of);
	}
}
