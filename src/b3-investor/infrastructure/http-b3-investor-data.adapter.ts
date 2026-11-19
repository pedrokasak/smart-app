import type { B3InvestorDataPort } from 'src/b3-investor/application/b3-investor-data.port';
import { B3InvestorError } from 'src/b3-investor/domain/b3-investor-error';
import type {
	B3AssetTrade,
	B3AuthorizedInvestor,
	B3DateRange,
	B3EquityMovement,
	B3EquityPosition,
	B3FixedIncomePosition,
	B3ReferenceDate,
	B3TreasuryBondPosition,
	B3UpdatedProduct,
} from 'src/b3-investor/domain/b3-investor.types';
import type { B3AccessTokenProvider } from './b3-access-token.provider';
import type { B3HttpTransport } from './b3-http.transport';

type Query = Record<string, string | number | undefined>;
type RawRecord = Record<string, unknown>;

interface PagedResponse {
	data?: RawRecord;
	Links?: { next?: string | null };
}

interface B3ErrorBody {
	Errors?: Array<{ code?: string; title?: string }>;
	errors?: Array<{ code?: string; title?: string }>;
}

/**
 * Teto de páginas por consulta (20 itens cada). Uma carteira real fica
 * muito abaixo disso; o limite só impede loop se a B3 devolver `next`
 * apontando sempre para a mesma página.
 */
const MAX_PAGES = 200;

const PATHS = {
	healthcheck: '/api/acesso/healthcheck',
	authorizedInvestors:
		'/api/authorization-investor/v1/authorizations/investors',
	updatedInvestors: '/api/updated-product/v1/investors',
	equityPositions: (doc: string) =>
		`/api/position/v3/equities/investors/${doc}`,
	treasuryBondPositions: (doc: string) =>
		`/api/position/v3/treasury-bonds/investors/${doc}`,
	fixedIncomePositions: (doc: string) =>
		`/api/position/v3/fixed-income/investors/${doc}`,
	equityMovements: (doc: string) =>
		`/api/movement/v2/equities/investors/${doc}`,
	assetTrades: (doc: string) => `/api/assets-trading/v2/investors/${doc}`,
};

function text(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown): string | null {
	return text(value) || null;
}

function amount(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function optionalAmount(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function records(value: unknown): RawRecord[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is RawRecord => !!item && typeof item === 'object'
			)
		: [];
}

/** CPF (11) ou CNPJ (14), só dígitos. A B3 não aceita outra forma. */
function normalizeDocument(documentNumber: string): string {
	const digits = String(documentNumber ?? '').replace(/\D/g, '');
	if (digits.length !== 11 && digits.length !== 14) {
		throw new B3InvestorError(
			'request_rejected',
			'Documento do investidor inválido: esperado CPF ou CNPJ'
		);
	}
	return digits;
}

/**
 * Rotas de um investidor (`/investors/{documento}`) ou da instituição
 * (healthcheck, autorizados, Guia). Muda como 403 e 404 são lidos.
 */
type Scope = 'investor' | 'institution';

/** Erros de certificado/chave não se resolvem tentando de novo. */
const TLS_ERROR = /CERT|SELF_SIGNED|SSL|TLS|OSSL|bad decrypt|certificate/i;

function transportError(error: unknown): B3InvestorError {
	const code = String((error as { code?: string })?.code ?? '');
	const message = String((error as Error)?.message ?? error);
	if (TLS_ERROR.test(code) || TLS_ERROR.test(message)) {
		return new B3InvestorError(
			'tls_failed',
			`Falha de TLS com a B3 (certificado, chave ou CA): ${message}`
		);
	}
	return new B3InvestorError(
		'unavailable',
		`Falha de rede ao chamar a B3: ${message}`
	);
}

/** A B3 manda "Compra"/"Venda"; outro valor não pode virar compra por padrão. */
function parseSide(value: unknown): 'buy' | 'sell' {
	const side = text(value).toLowerCase();
	if (side === 'compra') return 'buy';
	if (side === 'venda') return 'sell';
	throw new B3InvestorError(
		'unexpected_response',
		`Lado de negociação desconhecido na B3: "${side.slice(0, 20)}"`
	);
}

function describeB3Error(data: unknown): string {
	const body = data as B3ErrorBody | undefined;
	const first = body?.Errors?.[0] ?? body?.errors?.[0];
	if (!first) return '';
	return ` [${text(first.code)}] ${text(first.title)}`.slice(0, 160);
}

/**
 * Cliente das APIs da Área do Investidor (mTLS + Bearer). Faz a paginação,
 * renova o token uma vez em 401 e converte o formato da B3 para os tipos
 * de domínio.
 */
export class HttpB3InvestorDataAdapter implements B3InvestorDataPort {
	constructor(
		private readonly transport: B3HttpTransport,
		private readonly tokens: B3AccessTokenProvider,
		private readonly baseUrl: string
	) {}

	async healthcheck(): Promise<void> {
		await this.get(PATHS.healthcheck, undefined, 'institution');
	}

	async listAuthorizedInvestors(): Promise<B3AuthorizedInvestor[]> {
		const pages = await this.getAllPages(PATHS.authorizedInvestors, {});
		return pages.flatMap((data) =>
			records(data.authorizedInvestors)
				.map((row) => ({
					documentNumber: text(row.documentNumber),
					authorizedAt: optionalText(row.authorizationDatetime),
				}))
				.filter((row) => row.documentNumber)
		);
	}

	async listUpdatedInvestors(
		product: B3UpdatedProduct,
		range: B3DateRange
	): Promise<string[]> {
		const pages = await this.getAllPages(PATHS.updatedInvestors, {
			product,
			referenceStartDate: range.start,
			referenceEndDate: range.end,
		});
		const documents = pages.flatMap((data) =>
			records(data.updatedProducts).map((row) => text(row.documentNumber))
		);
		return [...new Set(documents.filter(Boolean))];
	}

	async getEquityPositions(
		documentNumber: string,
		referenceDate: B3ReferenceDate
	): Promise<B3EquityPosition[]> {
		const pages = await this.getAllPages(
			PATHS.equityPositions(normalizeDocument(documentNumber)),
			this.singleDay(referenceDate),
			'investor'
		);
		return pages.flatMap((data) =>
			records(data.equitiesPositions).map((row) => ({
				documentNumber: text(row.documentNumber),
				referenceDate: text(row.referenceDate),
				productCategory: text(row.productCategoryName),
				productType: text(row.productTypeName),
				ticker: text(row.tickerSymbol),
				isin: text(row.isin),
				quantity: amount(row.equitiesQuantity),
				availableQuantity: amount(row.availableQuantity),
				unavailableQuantity: amount(row.unavailableQuantity),
				closingPrice: amount(row.closingPrice),
				marketValue: amount(row.updateValue),
				custodian: text(row.participantName),
				custodianDocument: text(row.participantDocumentNumber),
			}))
		);
	}

	async getTreasuryBondPositions(
		documentNumber: string,
		referenceDate: B3ReferenceDate
	): Promise<B3TreasuryBondPosition[]> {
		const pages = await this.getAllPages(
			PATHS.treasuryBondPositions(normalizeDocument(documentNumber)),
			this.singleDay(referenceDate),
			'investor'
		);
		return pages.flatMap((data) =>
			records(data.treasuryBondsPositions).map((row) => ({
				documentNumber: text(row.documentNumber),
				referenceDate: text(row.referenceDate),
				ticker: text(row.tickerSymbol),
				isin: text(row.isin),
				description: text(row.assetDescription),
				expirationDate: text(row.expirationDate),
				quantity: amount(row.treasuryBondsQuantity),
				appliedValue: amount(row.applicationValue),
				marketValue: amount(row.updateValue),
				grossAmount: amount(row.grossAmount),
				netValue: amount(row.netValue),
				indexName: text(row.indexShortName),
				interestRate: amount(row.interestRate),
				custodian: text(row.participantName),
				custodianDocument: text(row.participantDocumentNumber),
			}))
		);
	}

	async getFixedIncomePositions(
		documentNumber: string,
		referenceDate: B3ReferenceDate
	): Promise<B3FixedIncomePosition[]> {
		const pages = await this.getAllPages(
			PATHS.fixedIncomePositions(normalizeDocument(documentNumber)),
			this.singleDay(referenceDate),
			'investor'
		);
		return pages.flatMap((data) =>
			records(data.fixedIncomePositions).map((row) => ({
				documentNumber: text(row.documentNumber),
				referenceDate: text(row.referenceDate),
				productType: text(row.productTypeName),
				ticker: text(row.tickerSymbol),
				issuer: text(row.corporationName),
				description: text(row.assetDescription),
				issueDate: text(row.issueDate),
				expirationDate: text(row.expirationDate),
				quantity: amount(row.fixedIncomeQuantity),
				availableQuantity: amount(row.availableQuantity),
				appliedValue: optionalAmount(row.applicationValue),
				marketValue: optionalAmount(row.updateValue),
				indexName: optionalText(row.indexShortName),
				custodian: text(row.participantName),
				custodianDocument: text(row.participantDocumentNumber),
			}))
		);
	}

	async getEquityMovements(
		documentNumber: string,
		range: B3DateRange
	): Promise<B3EquityMovement[]> {
		const pages = await this.getAllPages(
			PATHS.equityMovements(normalizeDocument(documentNumber)),
			this.period(range),
			'investor'
		);
		return pages.flatMap((data) => {
			const period = data.equitiesPeriods as RawRecord | undefined;
			return records(period?.equitiesMovements).map((row) => ({
				referenceDate: text(row.referenceDate),
				movementType: text(row.movementType),
				operationType: text(row.operationType),
				productType: text(row.productTypeName),
				ticker: text(row.tickerSymbol),
				isin: optionalText(row.isinCode),
				quantity: amount(row.equitiesQuantity),
				unitPrice: amount(row.unitPrice),
				operationValue: amount(row.operationValue),
				custodian: text(row.participantName),
				custodianDocument: text(row.participantDocumentNumber),
			}));
		});
	}

	async getAssetTrades(
		documentNumber: string,
		range: B3DateRange
	): Promise<B3AssetTrade[]> {
		const pages = await this.getAllPages(
			PATHS.assetTrades(normalizeDocument(documentNumber)),
			this.period(range),
			'investor'
		);
		return pages.flatMap((data) => {
			const periods = data.periods as RawRecord | undefined;
			return records(periods?.periodLists).flatMap((day) =>
				records(day.assetTradings).map((row) => ({
					referenceDate: text(day.referenceDate),
					ticker: text(row.tickerSymbol),
					side: parseSide(row.side),
					market: text(row.marketName),
					quantity: amount(row.tradeQuantity),
					price: optionalAmount(row.priceValue),
					grossAmount: optionalAmount(row.grossAmount),
					tradedAt: optionalText(row.tradeDateTime),
					custodian: text(row.participantName),
					custodianDocument: text(row.participantDocumentNumber),
				}))
			);
		});
	}

	private singleDay(referenceDate: B3ReferenceDate): Query {
		return {
			referenceStartDate: referenceDate,
			referenceEndDate: referenceDate,
		};
	}

	private period(range: B3DateRange): Query {
		return { referenceStartDate: range.start, referenceEndDate: range.end };
	}

	private async getAllPages(
		path: string,
		query: Query,
		scope: Scope = 'institution'
	): Promise<RawRecord[]> {
		const pages: RawRecord[] = [];
		for (let page = 1; page <= MAX_PAGES; page++) {
			const body = (await this.get(path, { ...query, page }, scope)) as
				| PagedResponse
				| undefined;
			if (!body) return pages;
			if (body.data) pages.push(body.data);
			if (!body.Links?.next) return pages;
		}
		// Devolver só parte das páginas gravaria uma carteira incompleta.
		throw new B3InvestorError(
			'unexpected_response',
			`B3 devolveu mais de ${MAX_PAGES} páginas em ${path.split('/investors')[0]}`
		);
	}

	/**
	 * GET autenticado. Em rotas de um investidor (`scope = 'investor'`):
	 * - 204/404 viram `undefined`, porque a B3 usa esses status quando o
	 *   investidor não tem dado no produto (a confirmar em certificação);
	 * - 403 vira `consent_missing`.
	 * Nas rotas da instituição (healthcheck, autorizados, Guia) 404 é erro
	 * de configuração e 403 é falta de permissão no contrato.
	 */
	private async get(
		path: string,
		query: Query | undefined,
		scope: Scope,
		retriedAfter401 = false
	): Promise<unknown> {
		const token = await this.tokens.getToken();
		let response;
		try {
			response = await this.transport.send({
				method: 'GET',
				url: `${this.baseUrl}${path}`,
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/json',
				},
				query,
			});
		} catch (error) {
			throw transportError(error);
		}

		const { status, data } = response;
		if (status >= 200 && status < 300) return status === 204 ? undefined : data;
		if (status === 404 && scope === 'investor') return undefined;
		if (status === 401 && !retriedAfter401) {
			this.tokens.invalidate();
			return this.get(path, query, scope, true);
		}

		const detail = describeB3Error(data);
		if (status === 401) {
			throw new B3InvestorError(
				'auth_failed',
				`B3 recusou o token${detail}`,
				status
			);
		}
		if (status === 403) {
			throw scope === 'investor'
				? new B3InvestorError(
						'consent_missing',
						`Sem consentimento ativo na B3${detail}`,
						status
					)
				: new B3InvestorError(
						'access_denied',
						`B3 negou acesso à API (contrato ou certificado)${detail}`,
						status
					);
		}
		if (status === 429) {
			throw new B3InvestorError(
				'rate_limited',
				`Limite da B3 atingido${detail}`,
				status
			);
		}
		if (status >= 500) {
			throw new B3InvestorError(
				'unavailable',
				`B3 indisponível (HTTP ${status})${detail}`,
				status
			);
		}
		throw new B3InvestorError(
			'request_rejected',
			`B3 rejeitou a requisição (HTTP ${status})${detail}`,
			status
		);
	}
}
