import type { AllocationBucket } from 'src/portfolio/target-allocation/application/allocation-exposure';
import type { BucketGap } from './rebalancing-gap';

/**
 * Onde colocar um aporte novo para aproximar a carteira da política-alvo sem
 * vender nada (TRA-141, prompt "Simular aporte de R$ 20k" do handoff).
 *
 * ## Por que rebalancear pelo aporte
 *
 * Vender o que está acima da meta gera ganho de capital tributável e pode
 * estourar a isenção de R$ 20 mil/mês em ações. Direcionar o dinheiro novo
 * para os baldes abaixo da meta corrige o desvio sem evento fiscal — é o
 * primeiro movimento de qualquer rebalanceamento sensato.
 *
 * ## A conta
 *
 * Com o aporte, o patrimônio passa a `total + aporte`. O valor-alvo de cada
 * balde é `alvo% × novo total`; o déficit é quanto falta até ele. O aporte é
 * repartido na proporção dos déficits. Se sobrar dinheiro depois de zerar
 * todos, o excedente segue os pesos-alvo.
 */

export interface ContributionSlice {
	bucket: AllocationBucket;
	amount: number;
	/** Peso do balde depois do aporte, 0-100. */
	resultingPct: number;
	targetPct: number;
}

export interface ContributionAllocationResult {
	contribution: number;
	slices: ContributionSlice[];
	/** Soma dos desvios absolutos antes e depois, em p.p. */
	driftBeforePct: number;
	driftAfterPct: number;
}

const round2 = (value: number): number => Number(value.toFixed(2));

export function allocateContribution(params: {
	buckets: BucketGap[];
	totalValue: number;
	contribution: number;
}): ContributionAllocationResult | null {
	const contribution = Number(params.contribution) || 0;
	const buckets = params.buckets || [];
	if (contribution <= 0 || !buckets.length) return null;

	const totalValue = Math.max(0, Number(params.totalValue) || 0);
	const newTotal = totalValue + contribution;
	const targetSum = buckets.reduce((sum, bucket) => sum + bucket.targetPct, 0);

	const current = buckets.map((bucket) => ({
		bucket,
		value: (bucket.currentPct / 100) * totalValue,
	}));
	const deficits = current.map(({ bucket, value }) =>
		Math.max(0, (bucket.targetPct / 100) * newTotal - value)
	);
	const deficitSum = deficits.reduce((sum, value) => sum + value, 0);

	const amounts = current.map((_, i) => {
		if (deficitSum <= 0) {
			return targetSum > 0
				? (buckets[i].targetPct / targetSum) * contribution
				: 0;
		}
		if (deficitSum >= contribution) {
			return (deficits[i] / deficitSum) * contribution;
		}
		// Sobra depois de zerar todos os déficits: segue os pesos-alvo.
		const remainder = contribution - deficitSum;
		const share =
			targetSum > 0 ? (buckets[i].targetPct / targetSum) * remainder : 0;
		return deficits[i] + share;
	});

	const slices: ContributionSlice[] = current
		.map(({ bucket, value }, i) => ({
			bucket: bucket.bucket,
			amount: round2(amounts[i]),
			resultingPct: round2(((value + amounts[i]) / newTotal) * 100),
			targetPct: bucket.targetPct,
		}))
		.filter((slice) => slice.amount > 0)
		.sort((a, b) => b.amount - a.amount);

	const driftAfter = current.reduce(
		(sum, { bucket, value }, i) =>
			sum +
			Math.abs(bucket.targetPct - ((value + amounts[i]) / newTotal) * 100),
		0
	);
	const driftBefore = buckets.reduce(
		(sum, bucket) => sum + Math.abs(bucket.gapPct),
		0
	);

	return {
		contribution: round2(contribution),
		slices,
		driftBeforePct: round2(driftBefore),
		driftAfterPct: round2(driftAfter),
	};
}

/**
 * Extrai o valor do aporte da pergunta: "R$ 20k", "20 mil", "R$ 20.000,50",
 * "5000". `null` quando não há número — o chat pede o valor em vez de chutar.
 */
export function parseContributionAmount(question: string): number | null {
	const text = String(question || '').toLowerCase();
	const match = text.match(
		/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(k|mil)?\b/
	);
	if (!match) return null;
	const integer = Number(match[1].replace(/\./g, ''));
	const cents = match[2] ? Number(`0.${match[2]}`) : 0;
	const multiplier = match[3] ? 1000 : 1;
	const value = (integer + cents) * multiplier;
	return value > 0 ? value : null;
}
