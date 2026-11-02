import { AllocationBreachedPayload } from 'src/events/domain/event-types';

export type AllocationBucket = AllocationBreachedPayload['bucket'];

export type ExposurePosition = {
	type?: string | null;
	quantity?: number | null;
	total?: number | null;
	price?: number | null;
	currentPrice?: number | null;
};

export type BucketExposure = Record<AllocationBucket, number>;

export const ALLOCATION_BUCKETS: readonly AllocationBucket[] = [
	'stocks',
	'crypto',
	'fiis',
	'other',
];

/**
 * Tipo do ativo -> balde da meta de alocacao (TRA-68). ETF e fundo nao tem
 * balde proprio na meta, entao caem em `other` — que e como a tela ja os
 * trata.
 */
export function toAllocationBucket(
	assetType?: string | null
): AllocationBucket {
	switch (String(assetType || '').toLowerCase()) {
		case 'stock':
			return 'stocks';
		case 'crypto':
			return 'crypto';
		case 'fii':
			return 'fiis';
		default:
			return 'other';
	}
}

/**
 * Valor de uma posicao a mercado: quantidade vezes a cotacao atual. Sem cotacao,
 * o `total` gravado e depois o preco de entrada. `total` vem por ultimo porque e
 * o custo de aquisicao: preferi-lo media a alocacao pelo que foi pago, nao pelo
 * que a carteira vale. Nunca inventa preco.
 */
export function positionValue(position: ExposurePosition): number {
	const quantity = Number(position?.quantity || 0);
	const current = Number(position?.currentPrice || 0);
	if (quantity > 0 && current > 0) return quantity * current;

	const total = Number(position?.total || 0);
	if (total > 0) return total;

	const price = Number(position?.price || 0);
	return quantity > 0 && price > 0 ? quantity * price : 0;
}

/**
 * Exposicao percentual por balde. Funcao pura — e regra, e regra testavel
 * sem Mongo. Carteira sem valor devolve todos os baldes em zero (e nao
 * NaN), porque dividir por zero aqui viraria evento com payload invalido.
 */
export function computeBucketExposure(
	positions: ExposurePosition[]
): BucketExposure {
	const valores: BucketExposure = { stocks: 0, crypto: 0, fiis: 0, other: 0 };

	let totalValue = 0;
	for (const position of positions ?? []) {
		const value = positionValue(position);
		if (value <= 0) continue;
		valores[toAllocationBucket(position?.type)] += value;
		totalValue += value;
	}

	if (totalValue <= 0) return valores;

	return ALLOCATION_BUCKETS.reduce((acc, bucket) => {
		acc[bucket] = (valores[bucket] / totalValue) * 100;
		return acc;
	}, {} as BucketExposure);
}
