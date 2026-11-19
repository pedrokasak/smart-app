import { positionName, positionSymbol } from './position-naming';
import type { FixedIncomePosition } from './fixed-income.types';

const base: FixedIncomePosition = {
	kind: 'CDB',
	indexer: 'PERCENT_CDI',
	ratePct: 110,
	principal: 1000,
	appliedAt: '2025-06-02',
	maturityDate: '2027-06-01',
};

describe('position naming (TRA-230)', () => {
	it('nomeia como o comparador, com o vencimento', () => {
		expect(positionName(base)).toBe('CDB 110% do CDI · vence 06/2027');
		expect(
			positionName({ ...base, kind: 'LCA', ratePct: 92.5, maturityDate: null })
		).toBe('LCA 92,5% do CDI');
		expect(
			positionName({
				...base,
				kind: 'TESOURO',
				indexer: 'IPCA_PLUS',
				ratePct: 6.2,
			})
		).toBe('Tesouro IPCA + 6,2% · vence 06/2027');
		expect(
			positionName({
				...base,
				kind: 'TESOURO',
				indexer: 'CDI_PLUS',
				ratePct: 0,
			})
		).toBe('Tesouro Selic · vence 06/2027');
		expect(positionName({ ...base, indexer: 'PREFIXED', ratePct: 13 })).toBe(
			'CDB prefixado 13% a.a. · vence 06/2027'
		);
	});

	it('símbolo interno carrega tipo, indexador, vencimento e sufixo único', () => {
		expect(positionSymbol(base, 'a1b2c3')).toBe('RF-CDB-CDI-202706-A1B2C3');
		expect(positionSymbol({ ...base, maturityDate: null }, 'x')).toBe(
			'RF-CDB-CDI-LIQ-X'
		);
	});
});
