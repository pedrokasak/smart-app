import {
	annualFromDailyPct,
	annualPctToPercentOfCdi,
	breakevenInflationPct,
	cdiPlusSpreadToAnnualPct,
	ipcaPlusToAnnualPct,
	percentOfCdiToAnnualPct,
	realReturnPct,
} from './rate-math';

describe('rate-math', () => {
	it('anualiza o CDI diário do BACEN na base de 252 dias úteis', () => {
		// SGS 12 = 0,050788% ao dia ↔ SGS 4389 = 13,65% ao ano.
		expect(annualFromDailyPct(0.050788)).toBeCloseTo(13.65, 2);
	});

	it('100% do CDI devolve o próprio CDI', () => {
		expect(percentOfCdiToAnnualPct(13.65, 100)).toBeCloseTo(13.65, 6);
	});

	it('% do CDI aplica a taxa DIÁRIA e capitaliza, não multiplica a anual', () => {
		const exact = percentOfCdiToAnnualPct(13.65, 110);
		expect(exact).toBeCloseTo(15.11312, 4);
		// A aproximação linear (13,65 × 1,10 = 15,015) subestima.
		expect(exact).toBeGreaterThan(13.65 * 1.1);
	});

	it('annualPctToPercentOfCdi é o inverso de percentOfCdiToAnnualPct', () => {
		const annual = percentOfCdiToAnnualPct(13.65, 87.3);
		expect(annualPctToPercentOfCdi(13.65, annual)).toBeCloseTo(87.3, 6);
	});

	it('IPCA+ e CDI+ multiplicam os fatores em vez de somar as taxas', () => {
		expect(ipcaPlusToAnnualPct(4.5, 7.55)).toBeCloseTo(12.38975, 5);
		expect(cdiPlusSpreadToAnnualPct(13.65, 0.09)).toBeCloseTo(13.752285, 5);
	});

	it('retorno real desconta a inflação por divisão', () => {
		expect(realReturnPct(10.45, 4.5)).toBeCloseTo(5.6938, 4);
		expect(realReturnPct(4.5, 4.5)).toBeCloseTo(0, 10);
	});

	it('inflação de empate entre prefixado e IPCA+', () => {
		expect(breakevenInflationPct(14.07, 7.55)).toBeCloseTo(6.0623, 4);
		// Com o IPCA exatamente nesse ponto, os dois rendem o mesmo.
		const breakeven = breakevenInflationPct(14.07, 7.55);
		expect(ipcaPlusToAnnualPct(breakeven, 7.55)).toBeCloseTo(14.07, 8);
	});
});
