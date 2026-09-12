import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { TrackerrIaDigestNarratorAdapter } from './trackerr-ia-digest-narrator.adapter';
import { PortfolioDigestFacts } from 'src/notifications/portfolio-digest/domain/portfolio-digest.types';

const mockHttpService = {
	post: jest.fn(),
};

function facts(
	overrides: Partial<PortfolioDigestFacts> = {}
): PortfolioDigestFacts {
	return {
		periodStart: '2026-08-11',
		periodEnd: '2026-08-18',
		portfolioValue: 10000,
		periodChangePct: 5,
		periodChangeAbs: 500,
		topGainers: [{ symbol: 'PETR4', changePercent: 3 }],
		topLosers: [{ symbol: 'VALE3', changePercent: -2 }],
		watchItems: [],
		dividendsReceived: 100,
		hasSufficientData: true,
		...overrides,
	};
}

function axiosResponse<T>(data: T): AxiosResponse<T> {
	return {
		data,
		status: 200,
		statusText: 'OK',
		headers: {},
		config: {} as any,
	};
}

describe('TrackerrIaDigestNarratorAdapter', () => {
	let adapter: TrackerrIaDigestNarratorAdapter;

	beforeEach(async () => {
		jest.clearAllMocks();
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				TrackerrIaDigestNarratorAdapter,
				{ provide: HttpService, useValue: mockHttpService },
			],
		}).compile();

		adapter = module.get<TrackerrIaDigestNarratorAdapter>(
			TrackerrIaDigestNarratorAdapter
		);
	});

	it('devolve o texto quando a resposta passa na validação', async () => {
		mockHttpService.post.mockReturnValue(
			of(axiosResponse({ text: 'Sua carteira subiu, puxada por PETR4.' }))
		);

		const result = await adapter.narrate(facts());

		expect(result).toBe('Sua carteira subiu, puxada por PETR4.');
	});

	it('devolve null quando a resposta cita ticker fora dos fatos', async () => {
		mockHttpService.post.mockReturnValue(
			of(axiosResponse({ text: 'WEGE3 teve um bom desempenho.' }))
		);

		const result = await adapter.narrate(facts());

		expect(result).toBeNull();
	});

	it('devolve null quando a resposta usa linguagem de recomendação', async () => {
		mockHttpService.post.mockReturnValue(
			of(axiosResponse({ text: 'Recomendo vender PETR4 essa semana.' }))
		);

		const result = await adapter.narrate(facts());

		expect(result).toBeNull();
	});

	it('devolve null e nunca lança quando a requisição falha', async () => {
		mockHttpService.post.mockReturnValue(
			throwError(() => new Error('connection refused'))
		);

		const result = await adapter.narrate(facts());

		expect(result).toBeNull();
	});

	it('devolve null quando o texto vem vazio', async () => {
		mockHttpService.post.mockReturnValue(of(axiosResponse({ text: '' })));

		const result = await adapter.narrate(facts());

		expect(result).toBeNull();
	});

	it('envia os fatos em snake_case pro trackerr-ia', async () => {
		mockHttpService.post.mockReturnValue(
			of(axiosResponse({ text: 'PETR4 subiu.' }))
		);

		await adapter.narrate(facts());

		expect(mockHttpService.post).toHaveBeenCalledWith(
			expect.stringContaining('/api/portfolio-digest-narrate'),
			expect.objectContaining({
				period_start: '2026-08-11',
				period_end: '2026-08-18',
				portfolio_value: 10000,
				top_gainers: [{ symbol: 'PETR4', change_percent: 3 }],
			}),
			expect.any(Object)
		);
	});
});
