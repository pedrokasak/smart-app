import { FundamentalsService } from './fundamentals.service';

function makeService(overrides: {
	fundamentusFields?: Record<string, { value: number | null; text: string }>;
	payoutInputs?: any;
}) {
	const fundamentus = {
		getFields: jest.fn().mockResolvedValue(overrides.fundamentusFields ?? {}),
	};
	const yahoo = {
		getPayoutInputs: jest.fn().mockResolvedValue(
			overrides.payoutInputs ?? {
				payoutRatio: null,
				dividendsPaid: null,
				netIncome: null,
				fiscalPeriod: null,
			}
		),
	};
	const service = new FundamentalsService(fundamentus as any, yahoo as any);
	return { service, fundamentus, yahoo };
}

const BANCO = {
	SETOR: { value: null, text: 'Intermediários Financeiros' },
	ROIC: { value: null, text: '-' },
	'MARG. LIQUIDA': { value: 0, text: '0,0%' },
};

const NAO_BANCO = {
	SETOR: { value: null, text: 'Máquinas e Equipamentos' },
	ROIC: { value: 24.3, text: '24,3%' },
	'MARG. LIQUIDA': { value: 16.6, text: '16,6%' },
	'DIV. LIQUIDA': { value: -3734800000, text: '-3.734.800.000' },
};

describe('FundamentalsService', () => {
	beforeEach(() => {
		(FundamentalsService as any).answered.clear();
	});

	it('marca ROIC de banco como nao aplicavel, nao como zero', async () => {
		const { service } = makeService({ fundamentusFields: BANCO });
		const result = await service.getFundamentals('BBAS3', {});
		expect(result.values.roic.status).toBe('not_applicable');
		expect(result.values.roic.value).toBeNull();
	});

	it('descarta a margem 0,0% que a fonte publica para banco', async () => {
		const { service } = makeService({ fundamentusFields: BANCO });
		const result = await service.getFundamentals('BBAS3', {});
		expect(result.values.netMargin.status).toBe('not_applicable');
		expect(result.values.netMargin.value).toBeNull();
	});

	it('entrega os tres indicadores para nao banco, com origem', async () => {
		const { service } = makeService({ fundamentusFields: NAO_BANCO });
		const result = await service.getFundamentals('WEGE3', {});
		expect(result.values.roic).toEqual({
			status: 'ok',
			value: 24.3,
			source: 'fundamentus',
		});
		expect(result.values.netMargin.value).toBeCloseTo(16.6, 5);
		expect(result.values.netDebt.value).toBe(-3734800000);
	});

	it('prefere a fonte que cobre o grupo inteiro, mesmo com a brapi tendo o P/L', async () => {
		// A brapi vem primeiro na ordem, mas so cobre priceEarnings. O
		// Fundamentus cobre o grupo todo, entao e ele quem responde — inclusive
		// pelo P/L. E o que mantem os numeros no mesmo balanco.
		const { service } = makeService({
			fundamentusFields: {
				...NAO_BANCO,
				'P/L': { value: 31.88, text: '31,88' },
				'P/VP': { value: 10.5, text: '10,50' },
				ROE: { value: 33.2, text: '33,2%' },
			},
		});
		const result = await service.getFundamentals('WEGE3', {
			priceEarnings: 31.97,
		});
		expect(result.values.priceEarnings.source).toBe('fundamentus');
		expect(result.values.priceEarnings.value).toBeCloseTo(31.88, 5);
		expect(result.mixed).toBe(false);
	});

	it('desce para campo a campo e marca mixed quando ninguem cobre o grupo', async () => {
		// Fundamentus sem P/L: nenhuma fonte cobre tudo sozinha, entao o
		// preenchimento campo a campo entra e o resultado e declarado misto.
		const { service } = makeService({ fundamentusFields: NAO_BANCO });
		const result = await service.getFundamentals('WEGE3', {
			priceEarnings: 31.97,
		});
		expect(result.values.priceEarnings.source).toBe('brapi');
		expect(result.values.roic.source).toBe('fundamentus');
		expect(result.mixed).toBe(true);
	});

	it('devolve unavailable, nunca zero, quando ninguem cobre', async () => {
		const { service } = makeService({ fundamentusFields: {} });
		const result = await service.getFundamentals('XPTO3', {});
		expect(result.values.roic).toEqual({
			status: 'unavailable',
			value: null,
			source: null,
		});
	});

	it('nao derruba os demais quando o Fundamentus falha', async () => {
		const { service, fundamentus } = makeService({});
		fundamentus.getFields.mockRejectedValue(new Error('puppeteer morreu'));
		const result = await service.getFundamentals('WEGE3', {
			priceEarnings: 31.97,
		});
		expect(result.values.priceEarnings.status).toBe('ok');
		expect(result.values.roic.status).toBe('unavailable');
	});

	it('calcula payout pelos totais do mesmo exercicio', async () => {
		const { service } = makeService({
			fundamentusFields: NAO_BANCO,
			payoutInputs: {
				payoutRatio: null,
				dividendsPaid: -3817472000,
				netIncome: 6254050000,
				fiscalPeriod: '2024',
			},
		});
		const result = await service.getFundamentals('WEGE3', {});
		expect(result.values.payout.status).toBe('ok');
		expect(result.values.payout.value).toBeCloseTo(61.04, 1);
		expect(result.values.payout.source).toBe('derived');
	});

	it('prefere o payout reportado ao calculado', async () => {
		const { service } = makeService({
			fundamentusFields: NAO_BANCO,
			payoutInputs: {
				payoutRatio: 0.55,
				dividendsPaid: -3817472000,
				netIncome: 6254050000,
				fiscalPeriod: '2024',
			},
		});
		const result = await service.getFundamentals('WEGE3', {});
		expect(result.values.payout.value).toBeCloseTo(55, 5);
		expect(result.values.payout.source).toBe('yahoo');
	});

	it('nunca devolve 0.65 fixo de payout', async () => {
		const { service } = makeService({ fundamentusFields: {} });
		const result = await service.getFundamentals('XPTO3', {});
		expect(result.values.payout.value).not.toBe(0.65);
		expect(result.values.payout.status).toBe('unavailable');
	});

	it('deixa indicador que nenhuma fonte publica como unavailable, sem sujar mixed', async () => {
		// evEbitda nao e publicado pela brapi no plano gratuito nem pelo
		// Fundamentus. Ele nao pode impedir o ramo de coerencia de disparar.
		const { service } = makeService({
			fundamentusFields: {
				...NAO_BANCO,
				'P/L': { value: 31.88, text: '31,88' },
				'P/VP': { value: 10.5, text: '10,50' },
				ROE: { value: 33.2, text: '33,2%' },
			},
		});
		const result = await service.getFundamentals('WEGE3', {});
		expect(result.values.evEbitda.status).toBe('unavailable');
		expect(result.mixed).toBe(false);
	});

	it('registra em log quando uma fonte que respondia para de responder', async () => {
		const { service, fundamentus } = makeService({
			fundamentusFields: NAO_BANCO,
		});
		const warn = jest
			.spyOn((service as any).logger, 'warn')
			.mockImplementation(() => undefined);

		await service.getFundamentals('WEGE3', {});
		expect(warn).not.toHaveBeenCalled();

		fundamentus.getFields.mockResolvedValue({});
		await service.getFundamentals('WEGE3', {});

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('fundamentus'));
	});

	it('acusa deriva quando a pagina responde mas nenhum rotulo desejado resolve', async () => {
		// Este e o cenario que o detector existe para pegar e que ele nao pegava:
		// o Fundamentus devolve ~60 chaves mesmo quando o layout dos rotulos
		// muda, entao contar chaves declarava a fonte saudavel. Aqui a fonte
		// responde com um mapa cheio, mas de rotulos que nao sao os nossos.
		const { service, fundamentus } = makeService({
			fundamentusFields: NAO_BANCO,
		});
		const warn = jest
			.spyOn((service as any).logger, 'warn')
			.mockImplementation(() => undefined);

		await service.getFundamentals('WEGE3', {});
		expect(warn).not.toHaveBeenCalled();

		const layoutNovo: Record<string, { value: number | null; text: string }> =
			{};
		for (let i = 0; i < 60; i++) {
			layoutNovo[`CAMPO ${i}`] = { value: i, text: String(i) };
		}
		fundamentus.getFields.mockResolvedValue(layoutNovo);
		await service.getFundamentals('WEGE3', {});

		expect(warn).toHaveBeenCalledWith(expect.stringContaining('fundamentus'));
	});

	it('nao marca mixed quando o grupo veio coerente e so o payout veio de outra fonte', async () => {
		const { service } = makeService({
			fundamentusFields: {
				...NAO_BANCO,
				'P/L': { value: 31.88, text: '31,88' },
				'P/VP': { value: 10.5, text: '10,50' },
				ROE: { value: 33.2, text: '33,2%' },
			},
			payoutInputs: {
				payoutRatio: 0.55,
				dividendsPaid: null,
				netIncome: null,
				fiscalPeriod: null,
			},
		});
		const result = await service.getFundamentals('WEGE3', {
			priceEarnings: 31.97,
		});
		expect(result.mixed).toBe(false);
		expect(result.values.payout.source).toBe('yahoo');
	});

	it('mantem mixed quando o grupo em si veio de fontes diferentes, mesmo com payout resolvido', async () => {
		const { service } = makeService({
			fundamentusFields: NAO_BANCO,
			payoutInputs: {
				payoutRatio: 0.55,
				dividendsPaid: null,
				netIncome: null,
				fiscalPeriod: null,
			},
		});
		const result = await service.getFundamentals('WEGE3', {
			priceEarnings: 31.97,
		});
		expect(result.values.priceEarnings.source).toBe('brapi');
		expect(result.values.roic.source).toBe('fundamentus');
		expect(result.mixed).toBe(true);
	});
});
