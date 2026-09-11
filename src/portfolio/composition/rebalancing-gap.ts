import {
	ALLOCATION_BUCKETS,
	computeBucketExposure,
	type AllocationBucket,
	type ExposurePosition,
} from 'src/portfolio/target-allocation/application/allocation-exposure';
import { TargetAllocationData } from 'src/portfolio/target-allocation/target-allocation.service';

/**
 * Distância entre a alocação atual e a política-alvo (TRA-141).
 *
 * ## O que muda em relação ao alerta que já existe
 *
 * `AllocationBreachProducer` já compara os dois e dispara aviso quando o desvio
 * passa do limiar. Ele responde "estourei a meta?" — pergunta binária, que só
 * aparece quando a resposta é sim.
 *
 * Aqui a pergunta é outra: "quanto e para onde preciso mover?". É informação
 * contínua, útil mesmo dentro da meta, e é o que falta para o rebalanceamento
 * deixar de ser conta de cabeça.
 *
 * A exposição atual vem de `computeBucketExposure`, o mesmo cálculo que
 * alimenta o alerta. Duplicar a regra faria a tela e o e-mail divergirem — o
 * tipo de problema que motivou unificar a engine fiscal em TRA-94.
 *
 * ## Convenção de sinal
 *
 * `gap` positivo significa ABAIXO da meta (falta comprar); negativo significa
 * acima (sobra). `amount` segue o mesmo sinal, em reais, e é quanto mover para
 * zerar o desvio — assumindo que o resto da carteira não muda.
 */

export interface BucketGap {
	bucket: AllocationBucket;
	/** Percentual atual da carteira, 0-100. */
	currentPct: number;
	/** Percentual alvo, 0-100. */
	targetPct: number;
	/** Alvo menos atual, em pontos percentuais. Positivo = falta comprar. */
	gapPct: number;
	/** Quanto mover em reais para zerar o desvio. Positivo = comprar. */
	amount: number;
}

export interface RebalancingGapResult {
	buckets: BucketGap[];
	/** Soma dos desvios absolutos, em pontos percentuais. */
	totalDriftPct: number;
	/** Balde mais distante da meta, ou `null` quando tudo está no lugar. */
	largestGap: BucketGap | null;
	/** false quando o usuário nunca configurou política-alvo. */
	hasTarget: boolean;
	totalValue: number;
}

const round2 = (value: number): number => Number(value.toFixed(2));

function positionValue(position: ExposurePosition): number {
	const quantity = Number(position?.quantity) || 0;
	const price = Number(position?.currentPrice) || Number(position?.price) || 0;
	const total = Number(position?.total) || 0;
	// Mesma precedência de `allocation-exposure`: valor a mercado quando dá,
	// `total` como último recurso.
	return quantity > 0 && price > 0 ? quantity * price : total;
}

export function computeRebalancingGap(params: {
	positions: ExposurePosition[];
	target: TargetAllocationData | null;
}): RebalancingGapResult {
	const positions = params.positions || [];
	const totalValue = positions.reduce(
		(sum, position) => sum + Math.max(0, positionValue(position)),
		0
	);

	// Sem meta configurada não existe desvio — devolver zeros sugeriria uma
	// carteira perfeitamente alinhada a uma política que não existe.
	if (!params.target) {
		return {
			buckets: [],
			totalDriftPct: 0,
			largestGap: null,
			hasTarget: false,
			totalValue: round2(totalValue),
		};
	}

	const current = computeBucketExposure(positions);

	const buckets: BucketGap[] = [];
	let totalDriftPct = 0;

	for (const bucket of ALLOCATION_BUCKETS) {
		const targetPct = Number(params.target[bucket]);
		// Balde ausente da meta não é meta zero: o usuário simplesmente não
		// opinou sobre ele. Entrar com 0 acusaria desvio de toda a posição.
		if (!Number.isFinite(targetPct)) continue;

		const currentPct = Number(current[bucket]) || 0;
		const gapPct = targetPct - currentPct;

		buckets.push({
			bucket,
			currentPct: round2(currentPct),
			targetPct: round2(targetPct),
			gapPct: round2(gapPct),
			amount: round2((gapPct / 100) * totalValue),
		});

		totalDriftPct += Math.abs(gapPct);
	}

	const largestGap = buckets.reduce<BucketGap | null>((largest, candidate) => {
		if (!largest) return candidate;
		return Math.abs(candidate.gapPct) > Math.abs(largest.gapPct)
			? candidate
			: largest;
	}, null);

	return {
		buckets,
		totalDriftPct: round2(totalDriftPct),
		largestGap,
		hasTarget: true,
		totalValue: round2(totalValue),
	};
}
