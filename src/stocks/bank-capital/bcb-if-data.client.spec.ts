import { fetchQuarterValues } from './bcb-if-data.client';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
	(global as any).fetch = jest.fn().mockResolvedValue({
		ok,
		status,
		json: async () => body,
	});
}

describe('fetchQuarterValues', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('converte fracao para ponto percentual', async () => {
		mockFetchOnce({
			value: [
				{ Conta: '79662', Saldo: 0.164727615151616 },
				{ Conta: '79664', Saldo: 0.141387163462059 },
			],
		});
		const result = await fetchQuarterValues('C0080329', '202503');
		expect(result.imobilizacao).toBeCloseTo(16.4727615151616, 5);
		expect(result.basileia).toBeCloseTo(14.1387163462059, 5);
	});

	it('desduplica linhas repetidas mantendo a primeira ocorrencia', async () => {
		mockFetchOnce({
			value: [
				{ Conta: '79664', Saldo: 0.1 },
				{ Conta: '79664', Saldo: 0.2 },
				{ Conta: '79664', Saldo: 0.3 },
			],
		});
		const result = await fetchQuarterValues('C0080329', '202509');
		expect(result.basileia).toBeCloseTo(10, 5);
	});

	it('devolve null para a conta ausente na resposta, sem afetar a outra', async () => {
		mockFetchOnce({
			value: [{ Conta: '79664', Saldo: 0.1414 }],
		});
		const result = await fetchQuarterValues('C0080329', '202506');
		expect(result.basileia).toBeCloseTo(14.14, 2);
		expect(result.imobilizacao).toBeNull();
	});

	it('devolve os dois null quando value vem vazio, marcando ok=true', async () => {
		mockFetchOnce({ value: [] });
		const result = await fetchQuarterValues('C0080329', '202606');
		expect(result).toEqual({ ok: true, basileia: null, imobilizacao: null });
	});

	it('marca ok=false quando o 200 vem sem o array value (forma OData inesperada)', async () => {
		mockFetchOnce({ error: { message: 'unexpected' } });
		await expect(fetchQuarterValues('C0080329', '202606')).resolves.toEqual({
			ok: false,
			basileia: null,
			imobilizacao: null,
		});
	});

	it('devolve os dois null em resposta HTTP de erro, sem lancar, marcando ok=false', async () => {
		mockFetchOnce({}, false, 500);
		await expect(fetchQuarterValues('C0080329', '202606')).resolves.toEqual({
			ok: false,
			basileia: null,
			imobilizacao: null,
		});
	});

	it('devolve os dois null quando o fetch rejeita, sem lancar, marcando ok=false', async () => {
		(global as any).fetch = jest.fn().mockRejectedValue(new Error('timeout'));
		await expect(fetchQuarterValues('C0080329', '202606')).resolves.toEqual({
			ok: false,
			basileia: null,
			imobilizacao: null,
		});
	});
});
