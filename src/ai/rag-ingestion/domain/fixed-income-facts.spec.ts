import { buildFixedIncomeItems } from 'src/ai/rag-ingestion/domain/fixed-income-facts';

const asset = (overrides: Record<string, unknown> = {}) => ({
	id: 'a1',
	type: 'fixed_income',
	fixedIncome: {
		kind: 'CDB',
		indexer: 'PERCENT_CDI',
		ratePct: 110,
		principal: 10000,
		appliedAt: '2025-03-15',
		maturityDate: '2028-06-15',
		valuation: {
			valuedAt: '2026-10-14',
			grossValue: 11234.56,
			netValue: 11050.4,
		},
	},
	...overrides,
});

describe('buildFixedIncomeItems (ADR-002, TRA-16)', () => {
	it('writes one chunk per position with the canonical name and rounded values', () => {
		const items = buildFixedIncomeItems([asset() as never], '2026-10-17');

		expect(items).toEqual([
			{
				sourceType: 'portfolio_fixed_income',
				sourceId: 'fixed_income:a1',
				content:
					'Renda fixa: CDB 110% do CDI · vence 06/2028. Aplicado R$ 10.000 em 15/03/2025. Valor bruto R$ 11.235, líquido de impostos R$ 11.050 (marcado em 14/10/2026).',
				metadata: { kind: 'CDB', indexer: 'PERCENT_CDI' },
				asOf: '2026-10-17',
			},
		]);
	});

	it('says so when the position has not been marked yet', () => {
		const withoutValuation = asset();
		(withoutValuation.fixedIncome as Record<string, unknown>).valuation = null;

		const [item] = buildFixedIncomeItems(
			[withoutValuation as never],
			'2026-10-17'
		);

		expect(item.content).toContain('Ainda sem marcação na curva.');
	});

	it('never carries the free text the user typed', () => {
		const withLabel = asset({
			name: 'CDB do Banco do João, ag 1234 conta 99887-6',
		});
		(withLabel.fixedIncome as Record<string, unknown>).label =
			'meu CDB joao@email.com';

		const [item] = buildFixedIncomeItems([withLabel as never], '2026-10-17');

		expect(item.content).not.toMatch(/Jo[aã]o|joao@|1234|99887/);
	});

	it('skips other asset types and assets without an id', () => {
		expect(
			buildFixedIncomeItems(
				[asset({ type: 'stock' }) as never, asset({ id: undefined }) as never],
				'2026-10-17'
			)
		).toEqual([]);
	});
});
