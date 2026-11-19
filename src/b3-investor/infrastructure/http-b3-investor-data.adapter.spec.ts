import { B3InvestorError } from 'src/b3-investor/domain/b3-investor-error';
import type { B3AccessTokenProvider } from './b3-access-token.provider';
import type {
	B3HttpRequest,
	B3HttpResponse,
	B3HttpTransport,
} from './b3-http.transport';
import { HttpB3InvestorDataAdapter } from './http-b3-investor-data.adapter';

const BASE_URL = 'https://apib3i-cert.b3.com.br:2443';
const CPF = '12345678901';

type Reply = { status: number; data?: unknown } | Error;

function buildAdapter(replies: Reply[]) {
	const send = jest.fn<Promise<B3HttpResponse>, [B3HttpRequest]>(async () => {
		const next = replies.shift();
		if (!next) throw new Error('unexpected request');
		if (next instanceof Error) throw next;
		return { status: next.status, data: next.data };
	});
	let tokenCount = 0;
	const tokens = {
		getToken: jest.fn(async () => `tok-${++tokenCount}`),
		invalidate: jest.fn(),
	};
	const adapter = new HttpB3InvestorDataAdapter(
		{ send } as B3HttpTransport,
		tokens as unknown as B3AccessTokenProvider,
		BASE_URL
	);
	return { adapter, send, tokens };
}

// Formatos tirados do Swagger público de developers.b3.com.br (2026-10-28).
const equityRow = {
	documentNumber: CPF,
	referenceDate: '2026-10-27',
	productCategoryName: 'Renda Variável',
	productTypeName: 'Ações',
	markingIndicator: false,
	tickerSymbol: 'PETR4',
	participantName: 'CORRETORA X',
	participantDocumentNumber: '00000000000191',
	equitiesQuantity: 100,
	closingPrice: 38.5,
	updateValue: 3850,
	isin: 'BRPETRACNPR6',
	availableQuantity: 100,
	unavailableQuantity: 0,
};

describe('HttpB3InvestorDataAdapter', () => {
	it('sends the bearer token and the single-day period for positions', async () => {
		const { adapter, send } = buildAdapter([
			{
				status: 200,
				data: {
					data: { equitiesPositions: [equityRow] },
					Links: { self: 'x' },
				},
			},
		]);

		const positions = await adapter.getEquityPositions(
			'123.456.789-01',
			'2026-10-27'
		);

		const request = send.mock.calls[0][0];
		expect(request.method).toBe('GET');
		expect(request.url).toBe(
			`${BASE_URL}/api/position/v3/equities/investors/${CPF}`
		);
		expect(request.headers?.Authorization).toBe('Bearer tok-1');
		expect(request.query).toEqual({
			referenceStartDate: '2026-10-27',
			referenceEndDate: '2026-10-27',
			page: 1,
		});
		expect(positions).toEqual([
			{
				documentNumber: CPF,
				referenceDate: '2026-10-27',
				productCategory: 'Renda Variável',
				productType: 'Ações',
				ticker: 'PETR4',
				isin: 'BRPETRACNPR6',
				quantity: 100,
				availableQuantity: 100,
				unavailableQuantity: 0,
				closingPrice: 38.5,
				marketValue: 3850,
				custodian: 'CORRETORA X',
				custodianDocument: '00000000000191',
			},
		]);
	});

	it('follows Links.next until the last page', async () => {
		const { adapter, send } = buildAdapter([
			{
				status: 200,
				data: {
					data: { equitiesPositions: [equityRow] },
					Links: { self: 'p1', next: 'p2' },
				},
			},
			{
				status: 200,
				data: {
					data: {
						equitiesPositions: [{ ...equityRow, tickerSymbol: 'VALE3' }],
					},
					Links: { self: 'p2' },
				},
			},
		]);

		const positions = await adapter.getEquityPositions(CPF, '2026-10-27');

		expect(positions.map((row) => row.ticker)).toEqual(['PETR4', 'VALE3']);
		expect(send.mock.calls.map(([request]) => request.query?.page)).toEqual([
			1, 2,
		]);
	});

	it('returns an empty list when the investor has no data (404)', async () => {
		const { adapter } = buildAdapter([{ status: 404, data: {} }]);

		await expect(
			adapter.getTreasuryBondPositions(CPF, '2026-10-27')
		).resolves.toEqual([]);
	});

	it('keeps fixed income values null when B3 sends no price', async () => {
		const { adapter } = buildAdapter([
			{
				status: 200,
				data: {
					data: {
						fixedIncomePositions: [
							{
								documentNumber: CPF,
								referenceDate: '2026-10-27',
								productTypeName: 'CDB',
								tickerSymbol: 'CDB123',
								corporationName: 'BANCO Y',
								assetDescription: 'CDB BANCO Y',
								issueDate: '2025-01-02',
								expirationDate: '2028-01-02',
								fixedIncomeQuantity: 10,
								availableQuantity: 10,
								participantName: 'CORRETORA X',
								participantDocumentNumber: '00000000000191',
							},
						],
					},
					Links: { self: 'x' },
				},
			},
		]);

		const [position] = await adapter.getFixedIncomePositions(CPF, '2026-10-27');

		expect(position).toMatchObject({
			issuer: 'BANCO Y',
			quantity: 10,
			appliedValue: null,
			marketValue: null,
			indexName: null,
		});
	});

	it('flattens trades per day and maps the side', async () => {
		const { adapter, send } = buildAdapter([
			{
				status: 200,
				data: {
					data: {
						periods: {
							documentNumber: CPF,
							referenceStartDate: '2026-10-01',
							referenceEndDate: '2026-10-27',
							periodLists: [
								{
									referenceDate: '2026-10-05',
									assetTradings: [
										{
											tickerSymbol: 'PETR4',
											side: 'Compra',
											marketName: 'Mercado à Vista',
											participantName: 'CORRETORA X',
											participantDocumentNumber: '00000000000191',
											tradeQuantity: 10,
											priceValue: 37.1,
											grossAmount: 371,
											tradeDateTime: '2026-10-05T10:15:00',
										},
										{
											tickerSymbol: 'VALE3',
											side: 'Venda',
											marketName: 'Mercado à Vista',
											participantName: 'CORRETORA X',
											participantDocumentNumber: '00000000000191',
											tradeQuantity: 5,
										},
									],
								},
							],
						},
					},
					Links: { self: 'x' },
				},
			},
		]);

		const trades = await adapter.getAssetTrades(CPF, {
			start: '2026-10-01',
			end: '2026-10-27',
		});

		expect(send.mock.calls[0][0].url).toBe(
			`${BASE_URL}/api/assets-trading/v2/investors/${CPF}`
		);
		expect(trades).toEqual([
			expect.objectContaining({
				referenceDate: '2026-10-05',
				ticker: 'PETR4',
				side: 'buy',
				quantity: 10,
				price: 37.1,
				grossAmount: 371,
				tradedAt: '2026-10-05T10:15:00',
			}),
			expect.objectContaining({
				ticker: 'VALE3',
				side: 'sell',
				price: null,
				tradedAt: null,
			}),
		]);
	});

	it('reads movements from the nested period object', async () => {
		const { adapter } = buildAdapter([
			{
				status: 200,
				data: {
					data: {
						equitiesPeriods: {
							documentNumber: CPF,
							equitiesMovements: [
								{
									referenceDate: '2026-10-10',
									movementType: 'Dividendo',
									operationType: 'Credito',
									productTypeName: 'Ações',
									tickerSymbol: 'ITSA4',
									participantName: 'CORRETORA X',
									participantDocumentNumber: '00000000000191',
									equitiesQuantity: 200,
									unitPrice: 0.12,
									operationValue: 24,
									isinCode: 'BRITSAACNPR7',
								},
							],
						},
					},
					Links: { self: 'x' },
				},
			},
		]);

		const movements = await adapter.getEquityMovements(CPF, {
			start: '2026-10-01',
			end: '2026-10-27',
		});

		expect(movements).toEqual([
			expect.objectContaining({
				movementType: 'Dividendo',
				ticker: 'ITSA4',
				isin: 'BRITSAACNPR7',
				operationValue: 24,
			}),
		]);
	});

	it('returns unique documents from the Guia API', async () => {
		const { adapter, send } = buildAdapter([
			{
				status: 200,
				data: {
					data: {
						product: 'EquitiesPosition',
						updatedProducts: [
							{ documentNumber: CPF },
							{ documentNumber: CPF },
							{ documentNumber: '98765432100' },
						],
					},
					Links: { self: 'x' },
				},
			},
		]);

		const documents = await adapter.listUpdatedInvestors('EquitiesPosition', {
			start: '2026-10-27',
			end: '2026-10-27',
		});

		expect(documents).toEqual([CPF, '98765432100']);
		expect(send.mock.calls[0][0].query).toEqual({
			product: 'EquitiesPosition',
			referenceStartDate: '2026-10-27',
			referenceEndDate: '2026-10-27',
			page: 1,
		});
	});

	it('lists authorized investors', async () => {
		const { adapter, send } = buildAdapter([
			{
				status: 200,
				data: {
					data: {
						authorizedInvestors: [
							{
								documentNumber: CPF,
								authorizationDatetime: '2026-10-20T12:00:00',
							},
							{ authorizationDatetime: '2026-10-21T12:00:00' },
						],
					},
					Links: { self: 'x' },
				},
			},
		]);

		await expect(adapter.listAuthorizedInvestors()).resolves.toEqual([
			{ documentNumber: CPF, authorizedAt: '2026-10-20T12:00:00' },
		]);
		expect(send.mock.calls[0][0].url).toBe(
			`${BASE_URL}/api/authorization-investor/v1/authorizations/investors`
		);
	});

	it('renews the token once after a 401 and retries the request', async () => {
		const { adapter, send, tokens } = buildAdapter([
			{ status: 401, data: {} },
			{ status: 200, data: {} },
		]);

		await adapter.healthcheck();

		expect(tokens.invalidate).toHaveBeenCalledTimes(1);
		expect(
			send.mock.calls.map(([request]) => request.headers?.Authorization)
		).toEqual(['Bearer tok-1', 'Bearer tok-2']);
	});

	it('fails with auth_failed when the retry also gets 401', async () => {
		const { adapter } = buildAdapter([
			{ status: 401, data: {} },
			{ status: 401, data: {} },
		]);

		await expect(adapter.healthcheck()).rejects.toMatchObject({
			kind: 'auth_failed',
			status: 401,
		});
	});

	it.each([
		[403, 'consent_missing', false],
		[429, 'rate_limited', true],
		[503, 'unavailable', true],
		[422, 'request_rejected', false],
	])('maps HTTP %i to %s', async (status, kind, retryable) => {
		const { adapter } = buildAdapter([
			{ status, data: { Errors: [{ code: 'E01', title: 'Erro de teste' }] } },
		]);

		const error = await adapter
			.getEquityPositions(CPF, '2026-10-27')
			.catch((e) => e);

		expect(error).toBeInstanceOf(B3InvestorError);
		expect(error).toMatchObject({ kind, status, retryable });
		expect(error.message).toContain('[E01] Erro de teste');
	});

	it('maps a network error to unavailable (retryable)', async () => {
		const { adapter } = buildAdapter([
			Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
		]);

		await expect(adapter.healthcheck()).rejects.toMatchObject({
			kind: 'unavailable',
			retryable: true,
		});
	});

	it.each([
		[{ code: 'SELF_SIGNED_CERT_IN_CHAIN' }, 'self signed certificate in chain'],
		[{}, 'error:1C800064:Provider routines::bad decrypt'],
		[{}, 'unable to verify the first certificate'],
	])(
		'maps certificate/key failures to tls_failed, not retryable (%o %s)',
		async (props, message) => {
			const { adapter } = buildAdapter([
				Object.assign(new Error(message), props),
			]);

			await expect(adapter.healthcheck()).rejects.toMatchObject({
				kind: 'tls_failed',
				retryable: false,
			});
		}
	);

	it('fails the healthcheck on 404 instead of treating it as no data', async () => {
		const { adapter } = buildAdapter([{ status: 404, data: {} }]);

		await expect(adapter.healthcheck()).rejects.toMatchObject({
			kind: 'request_rejected',
			status: 404,
		});
	});

	it('maps 403 on institution routes to access_denied', async () => {
		const { adapter } = buildAdapter([{ status: 403, data: {} }]);

		await expect(adapter.listAuthorizedInvestors()).rejects.toMatchObject({
			kind: 'access_denied',
			status: 403,
		});
	});

	it('rejects an unknown trade side instead of assuming a buy', async () => {
		const { adapter } = buildAdapter([
			{
				status: 200,
				data: {
					data: {
						periods: {
							periodLists: [
								{
									referenceDate: '2026-10-05',
									assetTradings: [{ tickerSymbol: 'PETR4', side: 'V' }],
								},
							],
						},
					},
					Links: { self: 'x' },
				},
			},
		]);

		await expect(
			adapter.getAssetTrades(CPF, { start: '2026-10-01', end: '2026-10-27' })
		).rejects.toMatchObject({ kind: 'unexpected_response' });
	});

	it('fails instead of returning partial data when pages never end', async () => {
		const { adapter, send } = buildAdapter(
			Array.from({ length: 200 }, () => ({
				status: 200,
				data: {
					data: { equitiesPositions: [equityRow] },
					Links: { self: 'p', next: 'p' },
				},
			}))
		);

		await expect(
			adapter.getEquityPositions(CPF, '2026-10-27')
		).rejects.toMatchObject({ kind: 'unexpected_response' });
		expect(send).toHaveBeenCalledTimes(200);
	});

	it('rejects an invalid document without calling B3', async () => {
		const { adapter, send } = buildAdapter([]);

		await expect(
			adapter.getEquityPositions('123', '2026-10-27')
		).rejects.toMatchObject({
			kind: 'request_rejected',
		});
		expect(send).not.toHaveBeenCalled();
	});
});
