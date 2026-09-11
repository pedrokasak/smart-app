import type { BucketGap } from './rebalancing-gap';
import {
	allocateContribution,
	parseContributionAmount,
} from './contribution-allocation';

const bucket = (
	name: BucketGap['bucket'],
	currentPct: number,
	targetPct: number
): BucketGap => ({
	bucket: name,
	currentPct,
	targetPct,
	gapPct: targetPct - currentPct,
	amount: 0,
});

describe('allocateContribution', () => {
	// Carteira de 100k: ações 60 (alvo 50), FIIs 40 (alvo 50).
	const buckets = [bucket('stocks', 60, 50), bucket('fiis', 40, 50)];

	it('manda o aporte para o balde abaixo da meta, sem vender nada', () => {
		const result = allocateContribution({
			buckets,
			totalValue: 100000,
			contribution: 20000,
		});

		// Novo total 120k: FIIs alvo 60k, tem 40k → déficit 20k; ações alvo
		// 60k, tem 60k → déficit 0. Todo o aporte vai para FIIs.
		expect(result?.slices).toEqual([
			{ bucket: 'fiis', amount: 20000, resultingPct: 50, targetPct: 50 },
		]);
		expect(result?.driftBeforePct).toBe(20);
		expect(result?.driftAfterPct).toBeCloseTo(0, 2);
	});

	it('reparte na proporção dos déficits quando o aporte não zera todos', () => {
		const result = allocateContribution({
			buckets: [
				bucket('stocks', 80, 40),
				bucket('fiis', 10, 30),
				bucket('crypto', 10, 30),
			],
			totalValue: 100000,
			contribution: 10000,
		});

		// Novo total 110k: FIIs e cripto têm o mesmo déficit (23k), ações 0.
		const amounts = result?.slices.map((slice) => slice.amount);
		expect(amounts).toEqual([5000, 5000]);
	});

	it('distribui a sobra pelos pesos-alvo depois de zerar os déficits', () => {
		const result = allocateContribution({
			buckets,
			totalValue: 100000,
			contribution: 40000,
		});

		// Déficit de FIIs = 70k − 40k = 30k; ações 70k − 60k = 10k. Soma 40k.
		const byBucket = Object.fromEntries(
			(result?.slices || []).map((slice) => [slice.bucket, slice.amount])
		);
		expect(byBucket.fiis).toBeCloseTo(30000, 2);
		expect(byBucket.stocks).toBeCloseTo(10000, 2);
	});

	it('não calcula sem meta ou sem aporte', () => {
		expect(
			allocateContribution({ buckets: [], totalValue: 1000, contribution: 100 })
		).toBeNull();
		expect(
			allocateContribution({ buckets, totalValue: 1000, contribution: 0 })
		).toBeNull();
	});
});

describe('parseContributionAmount', () => {
	it.each([
		['Simular aporte de R$ 20k', 20000],
		['quero aportar 20 mil', 20000],
		['aporte de R$ 20.000,50', 20000.5],
		['aporte de 5000', 5000],
	])('%s → %d', (question, expected) => {
		expect(parseContributionAmount(question)).toBeCloseTo(expected, 2);
	});

	it('devolve null sem valor na pergunta', () => {
		expect(parseContributionAmount('quero simular um aporte')).toBeNull();
	});
});
