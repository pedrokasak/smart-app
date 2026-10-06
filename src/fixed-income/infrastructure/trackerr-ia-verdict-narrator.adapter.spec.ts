import { HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import type { VerdictFacts } from '../application/verdict-facts';
import { TrackerrIaVerdictNarratorAdapter } from './trackerr-ia-verdict-narrator.adapter';

const facts: VerdictFacts = {
	scenario: {
		principal: 10000,
		years: 3,
		cdiPct: 13.65,
		ipcaPct: 4.5,
		irRatePct: 15,
	},
	ranking: [
		{
			name: 'CDB 110% do CDI',
			kind: 'CDB',
			exempt: false,
			grossAnnualPct: 15.11,
			netAnnualPct: 13.1,
			realAnnualPct: 8.23,
			netFinal: 14465.62,
		},
	],
	points: ['Um ponto.'],
};

const response = <T>(data: T): AxiosResponse<T> => ({
	data,
	status: 200,
	statusText: 'OK',
	headers: {},
	config: {} as AxiosResponse['config'],
});

describe('TrackerrIaVerdictNarratorAdapter', () => {
	const post = jest.fn();
	const adapter = new TrackerrIaVerdictNarratorAdapter({
		post,
	} as unknown as HttpService);

	beforeEach(() => post.mockReset());

	it('envia os fatos em snake_case para /api/fixed-income/verdict com o token de serviço', async () => {
		process.env.TRACKERR_IA_SERVICE_TOKEN = 'segredo-de-teste';
		post.mockReturnValue(of(response({ text: 'Texto da IA.' })));

		await expect(adapter.narrate(facts)).resolves.toBe('Texto da IA.');

		const [url, payload, config] = post.mock.calls[0];
		expect(url).toMatch(/\/api\/fixed-income\/verdict$/);
		expect(payload).toEqual({
			scenario: {
				principal: 10000,
				years: 3,
				cdi_pct: 13.65,
				ipca_pct: 4.5,
				ir_rate_pct: 15,
			},
			ranking: [
				{
					name: 'CDB 110% do CDI',
					kind: 'CDB',
					exempt: false,
					gross_annual_pct: 15.11,
					net_annual_pct: 13.1,
					real_annual_pct: 8.23,
					net_final: 14465.62,
				},
			],
			points: ['Um ponto.'],
		});
		expect(config.headers['x-service-token']).toBe('segredo-de-teste');
		expect(config.timeout).toBeGreaterThan(0);
		delete process.env.TRACKERR_IA_SERVICE_TOKEN;
	});

	it('devolve null (e não lança) quando a chamada falha', async () => {
		post.mockReturnValue(
			throwError(() => new Error('timeout of 15000ms exceeded'))
		);
		await expect(adapter.narrate(facts)).resolves.toBeNull();
	});

	it.each([[{}], [{ text: '' }], [{ text: '   ' }], [{ text: 42 }]])(
		'devolve null quando a resposta não traz texto utilizável: %j',
		async (body) => {
			post.mockReturnValue(of(response(body)));
			await expect(adapter.narrate(facts)).resolves.toBeNull();
		}
	);
});
