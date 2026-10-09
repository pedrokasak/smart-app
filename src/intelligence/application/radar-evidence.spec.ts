import { DEFAULT_INVESTMENT_POLICY } from 'src/investment-policy/domain/investment-policy';
import type { PortfolioIntelligenceOutput } from 'src/portfolio/intelligence/domain/portfolio-intelligence.types';
import type { PortfolioErrorRadarAlert } from './portfolio-error-radar.types';
import {
	EvidenceContext,
	MAX_POLICY_ASSET_ALERTS,
	RadarHolding,
	reductionToLimit,
	withEvidence,
} from './radar-evidence';

const entry = (key: string, percentage: number, total = 100_000) => ({
	key,
	percentage,
	value: (percentage / 100) * total,
	severity: 'low' as const,
});

function analysis(
	overrides: Partial<PortfolioIntelligenceOutput['facts']> = {}
): PortfolioIntelligenceOutput {
	return {
		facts: {
			totalValue: 100_000,
			positionsCount: 6,
			assetClassesCount: 2,
			sectorsCount: 3,
			geographiesCount: 1,
			unknownSectorExposurePct: 0,
			unknownGeographyExposurePct: 0,
			allocationByClass: [entry('equities', 90), entry('crypto', 10)],
			allocationByAsset: [],
			allocationByGeography: [],
			concentrationByAsset: [
				entry('PETR4', 10.9),
				entry('VALE3', 9),
				entry('ITUB4', 8.5),
				entry('BBAS3', 8.2),
				entry('WEGE3', 5),
			],
			concentrationBySector: [entry('ENERGIA', 30), entry('FINANCEIRO', 20)],
			...overrides,
		},
		rules: {
			thresholds: {
				highAssetConcentrationPct: 35,
				mediumAssetConcentrationPct: 20,
				highClassConcentrationPct: 60,
				mediumClassConcentrationPct: 40,
				highSectorConcentrationPct: 45,
				mediumSectorConcentrationPct: 25,
			},
		},
		estimates: {
			diversification: {
				score: 52,
				maxScore: 100,
				status: 'moderate',
				components: { assetSpread: 60, classSpread: 30, sectorSpread: 55 },
			},
			risk: {
				score: 50,
				level: 'medium',
				flags: [],
				weightedVolatility: 0.38,
				weightedBeta: 1.31,
			},
		} as unknown as PortfolioIntelligenceOutput['estimates'],
	};
}

const petr4: RadarHolding = {
	symbol: 'PETR4',
	assetType: 'stock',
	quantity: 363,
	price: 30,
	totalCost: 363 * 24,
};

function context(overrides: Partial<EvidenceContext> = {}): EvidenceContext {
	return {
		analysis: analysis(),
		policy: DEFAULT_INVESTMENT_POLICY,
		holdings: [petr4],
		basis: 'Valor de mercado de 6 posições, com cotações até 2026-10-08.',
		estimateTax: jest.fn(() => ({
			estimatedTax: 95.4,
			classification: 'tributavel',
		})),
		...overrides,
	};
}

const alert = (code: string, extra: Partial<PortfolioErrorRadarAlert> = {}) =>
	({
		code,
		type: 'concentration',
		severity: 'high',
		message: 'msg',
		...extra,
	}) as PortfolioErrorRadarAlert;

describe('reductionToLimit', () => {
	it('sells enough for the position to land at the limit after leaving the portfolio', () => {
		// V = 10.900, T = 100.000, L = 8% ⇒ x = 2.900 / 0,92 = 3.152,17 ⇒ 106 ações.
		expect(
			reductionToLimit({
				positionValue: 10_900,
				totalValue: 100_000,
				limitPct: 8,
				price: 30,
				assetType: 'stock',
			})
		).toEqual({ quantity: 106, amount: 3180, targetPct: 8 });
	});

	it('allows fractions for crypto', () => {
		const sale = reductionToLimit({
			positionValue: 10_000,
			totalValue: 100_000,
			limitPct: 5,
			price: 350_000,
			assetType: 'crypto',
		});
		expect(sale?.quantity).toBeCloseTo(0.015038, 6);
	});

	it('returns null when already within the limit or without price', () => {
		const base = {
			totalValue: 100_000,
			limitPct: 8,
			assetType: 'stock' as const,
		};
		expect(
			reductionToLimit({ ...base, positionValue: 7_000, price: 30 })
		).toBeNull();
		expect(
			reductionToLimit({ ...base, positionValue: 10_000, price: 0 })
		).toBeNull();
	});
});

describe('withEvidence', () => {
	it('shows the policy limit and the sale back to it on an engine concentration alert', () => {
		const ctx = context();
		const [enriched] = withEvidence(
			[alert('ASSET_CONCENTRATION_MEDIUM', { symbol: 'PETR4' })],
			ctx
		);

		expect(enriched.evidence).toEqual({
			metric: { label: 'Peso de PETR4', value: 10.9, unit: 'pct' },
			limit: {
				label: 'Limite por ativo da sua política',
				value: 8,
				unit: 'pct',
				source: 'policy',
			},
			excess: 2.9,
			basis: ctx.basis,
			rule: expect.stringContaining('20% (moderado) e 35% (alto)'),
		});
		expect(enriched.action).toMatchObject({
			kind: 'reduce_position',
			symbol: 'PETR4',
			quantity: 106,
			amount: 3180,
			targetPct: 8,
			estimatedTax: 95.4,
			taxClassification: 'tributavel',
		});
		expect(ctx.estimateTax).toHaveBeenCalledWith(petr4, 106);
	});

	it('turns the policy into alerts the engine thresholds never fire', () => {
		const alerts = withEvidence([], context());
		const policy = alerts.filter((a) => a.code === 'POLICY_ASSET_LIMIT');

		// PETR4 10,9%, VALE3 9%, ITUB4 8,5% e BBAS3 8,2% passam de 8%: só os três maiores.
		expect(policy).toHaveLength(MAX_POLICY_ASSET_ALERTS);
		expect(policy.map((a) => a.symbol)).toEqual(['PETR4', 'VALE3', 'ITUB4']);
		expect(policy[0].message).toBe(
			'PETR4 está em 10,9% da carteira, acima do limite de 8% da sua política.'
		);
		expect(policy[0].severity).toBe('medium');
	});

	it('does not repeat an asset the engine already flagged', () => {
		const alerts = withEvidence(
			[alert('ASSET_CONCENTRATION_MEDIUM', { symbol: 'PETR4' })],
			context()
		);

		expect(alerts.filter((a) => a.symbol === 'PETR4')).toHaveLength(1);
	});

	it('flags sector and crypto above the policy', () => {
		const alerts = withEvidence([], context());

		expect(
			alerts.find((a) => a.code === 'POLICY_SECTOR_LIMIT')?.evidence
		).toMatchObject({ metric: { value: 30 }, limit: { value: 25 }, excess: 5 });
		expect(
			alerts.find((a) => a.code === 'POLICY_CRYPTO_LIMIT')?.evidence
		).toMatchObject({ metric: { value: 10 }, limit: { value: 5 } });
	});

	it('leaves the sector to the engine alert when there is one', () => {
		const alerts = withEvidence(
			[alert('SECTOR_CONCENTRATION_MEDIUM')],
			context()
		);

		expect(alerts.some((a) => a.code === 'POLICY_SECTOR_LIMIT')).toBe(false);
		expect(alerts[0].evidence?.limit).toMatchObject({
			value: 25,
			source: 'policy',
		});
	});

	it('says why the tax is unknown without an average price', () => {
		const ctx = context({ holdings: [{ ...petr4, totalCost: null }] });
		const [first] = withEvidence([], ctx);

		expect(first.action?.estimatedTax).toBeNull();
		expect(first.action?.assumptions).toEqual([
			'Sem preço médio da posição, o IR da venda não pode ser estimado.',
		]);
		expect(ctx.estimateTax).not.toHaveBeenCalled();
	});

	it('gives no action when the position is not held or too small', () => {
		const alerts = withEvidence([], context({ holdings: [] }));

		expect(alerts.every((a) => a.action === undefined)).toBe(true);
	});

	it('explains diversification, volatility and beta with the model numbers', () => {
		const [div, vol, beta] = withEvidence(
			[
				alert('DIVERSIFICATION_MODERATE'),
				alert('VOLATILITY_MEDIUM'),
				alert('BETA_HIGH'),
			],
			context()
		);

		expect(div.evidence).toMatchObject({
			metric: { value: 52, unit: 'score' },
			limit: { value: 65, source: 'model' },
			excess: -13,
		});
		expect(div.evidence?.basis).toContain('ativos 60, classes 30, setores 55');
		expect(vol.evidence).toMatchObject({
			metric: { value: 38 },
			limit: { value: 30 },
		});
		expect(beta.evidence).toMatchObject({
			metric: { value: 1.31, unit: 'ratio' },
			limit: { value: 1.2 },
			excess: 0.11,
		});
	});

	it('names asset classes in Portuguese', () => {
		const [cls] = withEvidence([alert('CLASS_CONCENTRATION_HIGH')], context());

		expect(cls.evidence?.metric.label).toBe('Peso de Ações');
	});
});
