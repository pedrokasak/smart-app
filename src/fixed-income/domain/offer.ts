import type { BankInstrumentKind } from './fixed-income-tax';
import type { Instrument, OfferIndexer } from './instrument';

/** Taxa que a pessoa recebeu de um banco ou corretora (nada pré-cadastrado). */
export interface Offer {
	kind: BankInstrumentKind;
	indexer: OfferIndexer;
	ratePct: number;
	/** Texto livre só para exibição (ex.: "Banco X"). Nunca vai para a IA. */
	label?: string;
}

const KIND_LABEL: Record<BankInstrumentKind, string> = {
	CDB: 'CDB',
	LC: 'LC',
	LCI: 'LCI',
	LCA: 'LCA',
	CRI: 'CRI',
	CRA: 'CRA',
	DEBENTURE: 'Debênture',
	DEBENTURE_INCENTIVADA: 'Debênture incentivada',
};

/**
 * Faixa plausível de cada tipo de taxa. Existe para barrar erro de digitação
 * (110 no campo de prefixado, 1,1 no de % do CDI), não para opinar sobre o que
 * é uma boa oferta.
 */
export const OFFER_RATE_BOUNDS: Record<
	OfferIndexer,
	{ min: number; max: number; unit: string }
> = {
	PERCENT_CDI: { min: 1, max: 300, unit: '% do CDI' },
	PREFIXED: { min: 0.1, max: 60, unit: '% ao ano' },
	IPCA_PLUS: { min: 0, max: 40, unit: '% ao ano acima do IPCA' },
};

const formatRate = (value: number) =>
	value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** Mensagem de erro em português, ou `null` se a taxa é plausível. */
export function offerRateError(offer: Offer): string | null {
	const { min, max, unit } = OFFER_RATE_BOUNDS[offer.indexer];
	if (
		!Number.isFinite(offer.ratePct) ||
		offer.ratePct < min ||
		offer.ratePct > max
	) {
		return `Taxa fora da faixa aceita para ${KIND_LABEL[offer.kind]}: informe entre ${formatRate(min)} e ${formatRate(max)} (${unit}).`;
	}
	return null;
}

export function offerToInstrument(offer: Offer, index: number): Instrument {
	const kind = KIND_LABEL[offer.kind];
	const rate = formatRate(offer.ratePct);
	const name =
		offer.indexer === 'PERCENT_CDI'
			? `${kind} ${rate}% do CDI`
			: offer.indexer === 'PREFIXED'
				? `${kind} ${rate}% a.a.`
				: `${kind} IPCA + ${rate}% a.a.`;

	return {
		id: `offer-${index}`,
		name,
		kind: offer.kind,
		family: 'BANK',
		indexer: offer.indexer,
		ratePct: offer.ratePct,
		label: offer.label?.trim() || undefined,
	};
}
