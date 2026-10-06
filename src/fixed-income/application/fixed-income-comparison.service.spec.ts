import { BadRequestException } from '@nestjs/common';
import type { TesouroTitle } from '../domain/tesouro-title';
import { MarketRateUnavailableError } from './comparison.types';
import { FixedIncomeComparisonService } from './fixed-income-comparison.service';
import type {
	FixedIncomeRates,
	FixedIncomeRatesService,
} from './fixed-income-rates.service';

const NOW = new Date('2026-10-05T13:00:00.000Z');

const title = (
	family: TesouroTitle['family'],
	maturityDate: string,
	buyRatePct: number
): TesouroTitle => ({
	id: `${family}:${maturityDate}`,
	family,
	name: `${{ SELIC: 'Tesouro Selic', PREFIXED: 'Tesouro Prefixado', IPCA_PLUS: 'Tesouro IPCA+' }[family]} ${maturityDate.slice(0, 4)}`,
	maturityDate,
	buyRatePct,
	sellRatePct: buyRatePct + 0.12,
	unitPrice: 1000,
	baseDate: '2026-10-02',
});

const rates = (
	overrides: Partial<FixedIncomeRates> = {}
): FixedIncomeRates => ({
	cdi: {
		valuePct: 13.65,
		asOf: '2026-10-01',
		source: 'BACEN_SGS_12',
		stale: false,
	},
	selicMeta: {
		valuePct: 13.75,
		asOf: '2026-10-05',
		source: 'BACEN_SGS_432',
		stale: false,
	},
	ipca12m: {
		valuePct: 4.5,
		asOf: '2026-08-01',
		source: 'BACEN_SGS_433',
		stale: false,
	},
	tesouro: {
		baseDate: '2026-10-02',
		fetchedAt: '2026-10-05T13:00:00.000Z',
		stale: false,
		sourceUrl: 'https://www.tesourotransparente.gov.br/x.csv',
		titles: [
			title('SELIC', '2027-03-01', 0.01),
			title('SELIC', '2031-03-01', 0.09),
			title('PREFIXED', '2029-01-01', 13.83),
			title('PREFIXED', '2031-01-01', 14.07),
			title('IPCA_PLUS', '2029-05-15', 7.39),
			title('IPCA_PLUS', '2035-05-15', 7.55),
		],
	},
	...overrides,
});

const serviceWith = (marketRates: FixedIncomeRates) =>
	new FixedIncomeComparisonService(
		{ getRates: async () => marketRates } as unknown as FixedIncomeRatesService,
		() => NOW
	);

const base = { principal: 10_000, years: 3 };

describe('FixedIncomeComparisonService', () => {
	it('sem ofertas: um título por tipo pelo prazo, mais a referência do CDI', async () => {
		const result = await serviceWith(rates()).compare(base);

		expect(result.rows.map((row) => row.id)).toEqual([
			'SELIC:2031-03-01',
			'PREFIXED:2031-01-01',
			'IPCA_PLUS:2035-05-15',
			'reference-cdi',
		]);
		expect(result.scenario).toMatchObject({
			principal: 10_000,
			years: 3,
			days: 1095,
			horizonEnd: '2029-10-04',
			irRatePct: 15,
			cdi: { valuePct: 13.65, source: 'market', asOf: '2026-10-01' },
			ipca: { valuePct: 4.5, source: 'market', asOf: '2026-08-01' },
		});
		expect(result.tesouro).toMatchObject({
			baseDate: '2026-10-02',
			stale: false,
		});
		expect(result.selicMeta?.valuePct).toBe(13.75);
		expect(result.warnings).toEqual([]);
	});

	it('usa a taxa de COMPRA do Tesouro e os números batem com a simulação feita à mão', async () => {
		const result = await serviceWith(rates()).compare(base);
		const ipcaPlus = result.rows.find(
			(row) => row.id === 'IPCA_PLUS:2035-05-15'
		);
		expect(ipcaPlus?.ratePct).toBe(7.55);
		expect(ipcaPlus?.grossAnnualPct).toBeCloseTo(12.38975, 5);
		expect(ipcaPlus?.realAnnualPct).toBeCloseTo(5.9363, 4);
		expect(ipcaPlus?.note).toContain('2035'); // vence depois do prazo → marcação a mercado

		const selic = result.rows.find(
			(row) => row.family === 'TESOURO' && row.indexer === 'CDI_PLUS'
		);
		expect(selic?.grossAnnualPct).toBeCloseTo(13.752285, 5);
		expect(selic?.note).toBeUndefined();
	});

	it('marca exatamente um papel como o de maior retorno real', async () => {
		const result = await serviceWith(rates()).compare({
			...base,
			offers: [{ kind: 'CDB', indexer: 'PERCENT_CDI', ratePct: 110 }],
		});
		const best = result.rows.filter((row) => row.isBest);
		expect(best).toHaveLength(1);
		const maxReal = Math.max(...result.rows.map((row) => row.realAnnualPct));
		expect(best[0].realAnnualPct).toBe(maxReal);
	});

	it('ofertas do usuário entram com nome canônico, rótulo só para exibição e ordem preservada', async () => {
		const result = await serviceWith(rates()).compare({
			...base,
			offers: [
				{ kind: 'CDB', indexer: 'PERCENT_CDI', ratePct: 110, label: 'Banco X' },
				{ kind: 'LCI', indexer: 'PERCENT_CDI', ratePct: 95.5 },
				{ kind: 'CRI', indexer: 'IPCA_PLUS', ratePct: 7 },
				{ kind: 'DEBENTURE', indexer: 'PREFIXED', ratePct: 15.2 },
			],
		});
		const offers = result.rows.filter((row) => row.family === 'BANK');
		expect(offers.map((row) => row.name)).toEqual([
			'CDB 110% do CDI',
			'LCI 95,5% do CDI',
			'CRI IPCA + 7% a.a.',
			'Debênture 15,2% a.a.',
		]);
		expect(offers[0]).toMatchObject({
			id: 'offer-0',
			label: 'Banco X',
			exempt: false,
		});
		expect(offers[1]).toMatchObject({
			id: 'offer-1',
			exempt: true,
			irRatePct: 0,
		});
		expect(result.rows.at(-1)?.id).toBe('reference-cdi');
		// A leitura do cenário compara isento com tributado.
		expect(
			result.analysis.points.some((point) => point.text.includes('isenção'))
		).toBe(true);
	});

	it('CDI e IPCA digitados valem no lugar dos de mercado e dizem de onde vieram', async () => {
		const result = await serviceWith(rates()).compare({
			...base,
			cdiPct: 10,
			ipcaPct: 6,
		});
		expect(result.scenario.cdi).toEqual({ valuePct: 10, source: 'user' });
		expect(result.scenario.ipca).toEqual({ valuePct: 6, source: 'user' });
		const ref = result.rows.find((row) => row.id === 'reference-cdi');
		expect(ref?.grossAnnualPct).toBeCloseTo(10, 6);
	});

	it('sem CDI de mercado nem digitado, recusa em vez de supor um valor', async () => {
		const service = serviceWith(rates({ cdi: null }));
		await expect(service.compare(base)).rejects.toMatchObject({
			field: 'cdi',
			message: expect.stringContaining('CDI indisponível'),
		});
		await expect(service.compare(base)).rejects.toBeInstanceOf(
			MarketRateUnavailableError
		);
		// Informando o CDI, o cálculo segue.
		await expect(
			service.compare({ ...base, cdiPct: 13 })
		).resolves.toBeDefined();
	});

	it('sem IPCA de mercado nem digitado, recusa', async () => {
		await expect(
			serviceWith(rates({ ipca12m: null })).compare(base)
		).rejects.toMatchObject({
			field: 'ipca',
		});
	});

	it('Tesouro indisponível: segue só com ofertas e referência, com aviso', async () => {
		const result = await serviceWith(rates({ tesouro: null })).compare(base);
		expect(result.rows.map((row) => row.id)).toEqual(['reference-cdi']);
		expect(result.tesouro).toBeNull();
		expect(result.warnings.join(' ')).toContain('Tesouro Direto indisponíveis');
	});

	it('pregão do Tesouro antigo e CDI antigo geram aviso com a data em português', async () => {
		const result = await serviceWith(
			rates({
				cdi: {
					valuePct: 13.65,
					asOf: '2026-09-20',
					source: 'BACEN_SGS_12',
					stale: true,
				},
				tesouro: { ...rates().tesouro!, baseDate: '2026-09-25', stale: true },
			})
		).compare(base);
		expect(result.warnings.join(' ')).toContain(
			'O CDI de mercado é de 20/09/2026'
		);
		expect(result.warnings.join(' ')).toContain('pregão de 25/09/2026');
	});

	it('IPCA antigo avisa com o mês de referência, não com um dia 01 inventado', async () => {
		const result = await serviceWith(
			rates({
				ipca12m: {
					valuePct: 4.5,
					asOf: '2026-05-01',
					source: 'BACEN_SGS_433',
					stale: true,
				},
			})
		).compare(base);
		expect(result.warnings.join(' ')).toContain(
			'O IPCA de mercado é de 05/2026 e pode estar desatualizado.'
		);
	});

	it('escolha manual de títulos substitui a seleção automática; id que saiu da oferta vira aviso', async () => {
		const result = await serviceWith(rates()).compare({
			...base,
			tesouroIds: ['IPCA_PLUS:2029-05-15', 'PREFIXED:2099-01-01'],
		});
		expect(result.rows.map((row) => row.id)).toEqual([
			'IPCA_PLUS:2029-05-15',
			'reference-cdi',
		]);
		expect(result.warnings.join(' ')).toContain('não está mais à venda');
	});

	it('prazo maior que todo Prefixado e IPCA+: sai com aviso, Selic fica', async () => {
		const result = await serviceWith(rates()).compare({ ...base, years: 10 });
		expect(result.rows.map((row) => row.id)).toEqual([
			'SELIC:2031-03-01',
			'reference-cdi',
		]);
		expect(result.warnings.join(' ')).toContain('Tesouro Prefixado');
		expect(result.warnings.join(' ')).toContain('Tesouro IPCA+');
	});

	it('taxa de oferta fora da faixa plausível é erro 400, com a faixa na mensagem', async () => {
		const service = serviceWith(rates());
		await expect(
			service.compare({
				...base,
				offers: [{ kind: 'CDB', indexer: 'PREFIXED', ratePct: 110 }],
			})
		).rejects.toBeInstanceOf(BadRequestException);
		await expect(
			service.compare({
				...base,
				offers: [{ kind: 'LCI', indexer: 'PERCENT_CDI', ratePct: 0.9 }],
			})
		).rejects.toThrow('entre 1 e 300');
	});
});
