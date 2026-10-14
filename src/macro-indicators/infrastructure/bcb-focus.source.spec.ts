import axios from 'axios';
import { BcbFocusSource, latestAnnualSurvey } from './bcb-focus.source';

jest.mock('axios');
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

const annualRows = [
	{ Data: '2026-10-09', DataReferencia: '2026', Mediana: 5.2245 },
	{ Data: '2026-10-09', DataReferencia: '2027', Mediana: 4.3 },
	{ Data: '2026-10-08', DataReferencia: '2026', Mediana: 5.0159 },
	{ Data: '2026-10-09', DataReferencia: '2028', Mediana: 3.79 },
];

describe('latestAnnualSurvey', () => {
	it('fica só com a pesquisa mais recente', () => {
		expect(latestAnnualSurvey(annualRows)).toEqual({
			surveyDate: '2026-10-09',
			byYear: { 2026: 5.2245, 2027: 4.3, 2028: 3.79 },
		});
	});

	it('sem linha válida devolve null', () => {
		expect(latestAnnualSurvey([])).toBeNull();
		expect(
			latestAnnualSurvey([
				{ Data: '2026-10-09', DataReferencia: 'x', Mediana: 4 },
			])
		).toBeNull();
	});
});

describe('BcbFocusSource', () => {
	afterEach(() => mockedGet.mockReset());

	const respond = (twelveMonths: unknown[]) =>
		mockedGet.mockImplementation(async (url: string) => ({
			data: {
				value: url.endsWith('ExpectativasMercadoAnuais')
					? annualRows
					: twelveMonths,
			},
		}));

	it('junta a projeção de 12 meses e a anual numa leitura só', async () => {
		respond([{ Data: '2026-10-09', Mediana: 4.4772 }]);

		await expect(new BcbFocusSource().latest()).resolves.toEqual({
			surveyDate: '2026-10-09',
			next12mPct: 4.4772,
			byYear: { 2026: 5.2245, 2027: 4.3, 2028: 3.79 },
			source: 'BCB_FOCUS',
		});
		// Pede a série de 30 dias, suavizada, em JSON.
		const [, config] = mockedGet.mock.calls.find(([url]) =>
			String(url).endsWith('ExpectativasMercadoInflacao12Meses')
		)!;
		expect(config?.params).toMatchObject({
			$filter: "Indicador eq 'IPCA' and Suavizada eq 'S' and baseCalculo eq 0",
			$format: 'json',
		});
	});

	it('reusa a leitura dentro do cache', async () => {
		respond([{ Data: '2026-10-09', Mediana: 4.4772 }]);
		const source = new BcbFocusSource();

		await source.latest();
		await source.latest();
		expect(mockedGet).toHaveBeenCalledTimes(2);
	});

	it('resposta vazia ou erro vira null e tenta de novo na próxima', async () => {
		respond([]);
		const source = new BcbFocusSource();
		await expect(source.latest()).resolves.toBeNull();

		mockedGet.mockRejectedValue(new Error('timeout'));
		await expect(source.latest()).resolves.toBeNull();
		expect(mockedGet.mock.calls.length).toBe(4);
	});
});
