import {
	resolveTurnover,
	isAdvancedInstrumentSymbol,
	computeSophistication,
	computeRiskTolerance,
	computeConfidence,
	InvestorProfileSignalsInput,
} from './investor-profile-signals';

describe('resolveTurnover', () => {
	it('divide trades pelo numero de ativos distintos', () => {
		expect(resolveTurnover(3, 12)).toBe(4);
	});

	it('retorna 0 quando nao ha ativos, sem lancar', () => {
		expect(resolveTurnover(0, 5)).toBe(0);
	});
});

describe('isAdvancedInstrumentSymbol', () => {
	it('reconhece ETF pelo assetType', () => {
		expect(isAdvancedInstrumentSymbol('BOVA11', 'etf')).toBe(true);
	});

	it('reconhece BDR pelo padrao de sufixo', () => {
		expect(isAdvancedInstrumentSymbol('AAPL34', 'stock')).toBe(true);
		expect(isAdvancedInstrumentSymbol('GOGL34', 'stock')).toBe(true);
	});

	it('nao reconhece acao comum da B3 como avancada', () => {
		expect(isAdvancedInstrumentSymbol('PETR4', 'stock')).toBe(false);
		expect(isAdvancedInstrumentSymbol('ITUB4', 'stock')).toBe(false);
	});

	it('nao reconhece fii como avancado', () => {
		expect(isAdvancedInstrumentSymbol('XPLG11', 'fii')).toBe(false);
	});
});

describe('computeSophistication', () => {
	const base: InvestorProfileSignalsInput = {
		distinctAssetCount: 10,
		distinctSectorCount: 4,
		tradesLast12Months: 40,
		accountAgeDays: 365,
		variableIncomeAllocationPct: 70,
		hasAdvancedInstrument: false,
	};

	it('experienced: turnover alto, independente do numero de setores', () => {
		expect(computeSophistication(base)).toBe('experienced');
	});

	it('experienced: instrumento avancado, mesmo com turnover baixo e poucos setores', () => {
		expect(
			computeSophistication({
				...base,
				distinctSectorCount: 0,
				tradesLast12Months: 2,
				hasAdvancedInstrument: true,
			})
		).toBe('experienced');
	});

	it('experienced: turnover alto mesmo com distinctSectorCount zerado (Asset sem campo sector)', () => {
		expect(
			computeSophistication({
				...base,
				distinctSectorCount: 0,
			})
		).toBe('experienced');
	});

	it('beginner: poucos ativos vence mesmo com muitos setores', () => {
		expect(
			computeSophistication({
				...base,
				distinctAssetCount: 2,
				distinctSectorCount: 2,
			})
		).toBe('beginner');
	});

	it('beginner: conta nova vence mesmo com sinais de experiente', () => {
		expect(
			computeSophistication({
				...base,
				accountAgeDays: 10,
			})
		).toBe('beginner');
	});

	it('intermediate: nem experiente nem beginner', () => {
		expect(
			computeSophistication({
				...base,
				distinctSectorCount: 2,
				tradesLast12Months: 3,
				hasAdvancedInstrument: false,
			})
		).toBe('intermediate');
	});
});

describe('computeRiskTolerance', () => {
	it('nunca retorna aggressive, mesmo com 100% em renda variavel (sem tipo de renda fixa no schema)', () => {
		expect(computeRiskTolerance(100)).toBe('moderate');
		expect(computeRiskTolerance(85)).toBe('moderate');
	});

	it('moderate entre 40 e 80', () => {
		expect(computeRiskTolerance(60)).toBe('moderate');
		expect(computeRiskTolerance(40)).toBe('moderate');
	});

	it('conservative abaixo de 40', () => {
		expect(computeRiskTolerance(20)).toBe('conservative');
	});
});

describe('computeConfidence', () => {
	const base: InvestorProfileSignalsInput = {
		distinctAssetCount: 10,
		distinctSectorCount: 4,
		tradesLast12Months: 40,
		accountAgeDays: 365,
		variableIncomeAllocationPct: 70,
		hasAdvancedInstrument: false,
	};

	it('confidence maxima com sinais fortes', () => {
		expect(computeConfidence(base)).toBe(1.0);
	});

	it('reduz 0.3 por poucas transacoes', () => {
		expect(computeConfidence({ ...base, tradesLast12Months: 2 })).toBeCloseTo(
			0.7
		);
	});

	it('reduz 0.3 por conta nova, mas o teto de conta nova (<=0.4) prevalece', () => {
		expect(computeConfidence({ ...base, accountAgeDays: 5 })).toBeCloseTo(0.4);
	});

	it('reduz 0.2 por poucos ativos', () => {
		expect(computeConfidence({ ...base, distinctAssetCount: 1 })).toBeCloseTo(
			0.8
		);
	});

	it('com todos os sinais fracos, reduz por todas as tres condicoes (0.3 + 0.3 + 0.2)', () => {
		expect(
			computeConfidence({
				distinctAssetCount: 0,
				distinctSectorCount: 0,
				tradesLast12Months: 0,
				accountAgeDays: 1,
				variableIncomeAllocationPct: 0,
				hasAdvancedInstrument: false,
			})
		).toBeCloseTo(0.2);
	});

	it('reduz por poucas transacoes e conta nova (sem mexer em ativos)', () => {
		expect(
			computeConfidence({
				distinctAssetCount: 10,
				distinctSectorCount: 4,
				tradesLast12Months: 0,
				accountAgeDays: 1,
				variableIncomeAllocationPct: 70,
				hasAdvancedInstrument: false,
			})
		).toBeCloseTo(0.4);
	});

	it('reduz por poucas transacoes e poucos ativos (sem mexer em idade da conta)', () => {
		expect(
			computeConfidence({
				distinctAssetCount: 1,
				distinctSectorCount: 4,
				tradesLast12Months: 0,
				accountAgeDays: 365,
				variableIncomeAllocationPct: 70,
				hasAdvancedInstrument: false,
			})
		).toBeCloseTo(0.5);
	});

	it('reduz por conta nova e poucos ativos (sem mexer em transacoes), mas o teto de conta nova (<=0.4) prevalece', () => {
		expect(
			computeConfidence({
				distinctAssetCount: 1,
				distinctSectorCount: 4,
				tradesLast12Months: 40,
				accountAgeDays: 1,
				variableIncomeAllocationPct: 70,
				hasAdvancedInstrument: false,
			})
		).toBeCloseTo(0.4);
	});

	it('conta nova (< 30 dias) e limitada a 0.4 mesmo com sinais fortes', () => {
		expect(
			computeConfidence({
				distinctAssetCount: 10,
				distinctSectorCount: 4,
				tradesLast12Months: 40,
				accountAgeDays: 10,
				variableIncomeAllocationPct: 70,
				hasAdvancedInstrument: true,
			})
		).toBeLessThanOrEqual(0.4);
	});
});
