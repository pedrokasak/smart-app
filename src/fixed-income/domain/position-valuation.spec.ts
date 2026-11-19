import { businessDaysBetween, valuePosition } from './position-valuation';
import type { FixedIncomePosition, IndexRatePoint } from './fixed-income.types';

/** CDI constante em todos os dias úteis do intervalo. */
function constantCdi(
	from: string,
	to: string,
	value: number
): IndexRatePoint[] {
	return businessDaysBetween(from, to).map((date) => ({ date, value }));
}

const cdb = (patch: Partial<FixedIncomePosition>): FixedIncomePosition => ({
	kind: 'CDB',
	indexer: 'PERCENT_CDI',
	ratePct: 100,
	principal: 1000,
	appliedAt: '2025-06-02',
	...patch,
});

describe('valuePosition (TRA-230)', () => {
	describe('dias úteis', () => {
		it('pula fim de semana e Carnaval; Quarta de Cinzas conta', () => {
			expect(businessDaysBetween('2025-02-28', '2025-03-07')).toEqual([
				'2025-02-28',
				'2025-03-05',
				'2025-03-06',
			]);
		});

		it('junho e julho de 2025 têm 43 dias úteis (Corpus Christi em 19/06)', () => {
			expect(businessDaysBetween('2025-06-01', '2025-08-01')).toHaveLength(43);
		});
	});

	describe('% do CDI', () => {
		const cdiDaily = constantCdi('2025-06-02', '2025-06-16', 0.05);

		it('100% do CDI por 10 dias úteis, com IOF e IR de 14 dias corridos', () => {
			const result = valuePosition(cdb({}), '2025-06-16', { cdiDaily });

			expect(result).toEqual({
				valuedAt: '2025-06-16',
				grossValue: 1005.01,
				grossYield: 5.01,
				businessDays: 10,
				calendarDays: 14,
				iof: 2.66, // 53% do rendimento no 14º dia
				incomeTax: 0.53, // 22,5% de (5,01 − 2,66)
				incomeTaxRatePct: 22.5,
				netValue: 1001.82,
				taxExempt: false,
				estimatedPeriods: 0,
			});
		});

		it('110% do CDI aplica o percentual à taxa diária', () => {
			const result = valuePosition(cdb({ ratePct: 110 }), '2025-06-16', {
				cdiDaily,
			});
			expect(result?.grossValue).toBe(1005.51);
		});

		it('dia sem CDI publicado usa o último e conta como estimado', () => {
			const result = valuePosition(cdb({}), '2025-06-16', {
				cdiDaily: cdiDaily.slice(0, 8),
			});
			expect(result?.grossValue).toBe(1005.01);
			expect(result?.estimatedPeriods).toBe(2);
		});

		it('sem nenhum CDI não dá para marcar', () => {
			expect(valuePosition(cdb({}), '2025-06-16', {})).toBeNull();
		});

		it('no dia da aplicação vale o principal', () => {
			expect(valuePosition(cdb({}), '2025-06-02', {})).toMatchObject({
				grossValue: 1000,
				grossYield: 0,
				netValue: 1000,
				businessDays: 0,
			});
		});
	});

	it('LCA é isenta de IR e, passados 30 dias, de IOF', () => {
		const from = '2025-01-02';
		const to = '2025-04-02';
		const result = valuePosition(
			cdb({ kind: 'LCA', ratePct: 95, appliedAt: from }),
			to,
			{ cdiDaily: constantCdi(from, to, 0.05) }
		);

		expect(result?.taxExempt).toBe(true);
		expect(result?.incomeTax).toBe(0);
		expect(result?.iof).toBe(0);
		expect(result?.netValue).toBe(result?.grossValue);
	});

	it('prefixado: (1 + taxa)^(dias úteis / 252)', () => {
		const result = valuePosition(
			cdb({ indexer: 'PREFIXED', ratePct: 12 }),
			'2025-06-16',
			{}
		);
		expect(result?.grossValue).toBe(
			Math.round(1000 * 1.12 ** (10 / 252) * 100) / 100
		);
	});

	it('Tesouro Selic (CDI + spread): fatores se multiplicam', () => {
		const result = valuePosition(
			cdb({ kind: 'TESOURO', indexer: 'CDI_PLUS', ratePct: 0.1 }),
			'2025-06-16',
			{ cdiDaily: constantCdi('2025-06-02', '2025-06-16', 0.05) }
		);
		expect(result?.grossValue).toBe(
			Math.round(1000 * 1.0005 ** 10 * 1.001 ** (10 / 252) * 100) / 100
		);
	});

	describe('IPCA +', () => {
		const ipcaMonthly = [
			{ date: '2025-06-01', value: 0.5 },
			{ date: '2025-07-01', value: 0.4 },
		];
		const tesouroIpca = cdb({
			kind: 'TESOURO',
			indexer: 'IPCA_PLUS',
			ratePct: 6,
			appliedAt: '2025-06-01',
		});

		it('inflação encadeada vezes o juro real nos dias úteis', () => {
			const result = valuePosition(tesouroIpca, '2025-08-01', { ipcaMonthly });
			expect(result?.grossValue).toBe(
				Math.round(1000 * 1.005 * 1.004 * 1.06 ** (43 / 252) * 100) / 100
			);
			expect(result?.estimatedPeriods).toBe(0);
		});

		it('mês sem IPCA publicado usa o último e avisa', () => {
			const result = valuePosition(tesouroIpca, '2025-09-01', { ipcaMonthly });
			expect(result?.estimatedPeriods).toBe(1);
		});

		it('deflação que zera o rendimento não gera imposto', () => {
			const result = valuePosition(
				{ ...tesouroIpca, ratePct: 0 },
				'2025-07-01',
				{ ipcaMonthly: [{ date: '2025-06-01', value: -2 }] }
			);
			expect(result?.grossYield).toBeLessThan(0);
			expect(result?.iof).toBe(0);
			expect(result?.incomeTax).toBe(0);
		});

		it('sem IPCA até a aplicação não dá para marcar', () => {
			expect(valuePosition(tesouroIpca, '2025-08-01', {})).toBeNull();
		});
	});

	it('depois do vencimento o valor para de render', () => {
		const cdiDaily = constantCdi('2025-06-02', '2025-07-31', 0.05);
		const atMaturity = valuePosition(
			cdb({ maturityDate: '2025-06-16' }),
			'2025-06-16',
			{ cdiDaily }
		);
		const later = valuePosition(
			cdb({ maturityDate: '2025-06-16' }),
			'2025-07-31',
			{ cdiDaily }
		);
		expect(later).toEqual(atMaturity);
		expect(later?.valuedAt).toBe('2025-06-16');
	});
});
