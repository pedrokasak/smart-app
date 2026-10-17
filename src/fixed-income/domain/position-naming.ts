import { toBrMonth } from './dates';
import type { FixedIncomePosition, PositionKind } from './fixed-income.types';

/**
 * Nome e símbolo de uma posição de renda fixa (TRA-230). A posição não tem
 * ticker: o nome sai do tipo, do indexador, da taxa e do vencimento, no
 * mesmo formato que o comparador usa ("CDB 110% do CDI").
 */

const KIND_LABEL: Record<PositionKind, string> = {
	CDB: 'CDB',
	LC: 'LC',
	LCI: 'LCI',
	LCA: 'LCA',
	CRI: 'CRI',
	CRA: 'CRA',
	DEBENTURE: 'Debênture',
	DEBENTURE_INCENTIVADA: 'Debênture incentivada',
	TESOURO: 'Tesouro',
};

const formatRate = (value: number) =>
	value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

function rateLabel(position: FixedIncomePosition): string {
	const rate = formatRate(position.ratePct);
	switch (position.indexer) {
		case 'PERCENT_CDI':
			return `${rate}% do CDI`;
		case 'CDI_PLUS':
			return position.ratePct > 0 ? `Selic + ${rate}%` : 'Selic';
		case 'PREFIXED':
			return `prefixado ${rate}% a.a.`;
		case 'IPCA_PLUS':
			return `IPCA + ${rate}%`;
	}
}

export function positionName(position: FixedIncomePosition): string {
	const base = `${KIND_LABEL[position.kind]} ${rateLabel(position)}`;
	return position.maturityDate
		? `${base} · vence ${toBrMonth(position.maturityDate)}`
		: base;
}

/**
 * Símbolo interno, único por posição: duas aplicações iguais no mesmo dia
 * são posições diferentes (a B3 também as separa). `uniqueSuffix` vem de
 * quem cria (ex.: final do ObjectId) para a função continuar pura.
 */
export function positionSymbol(
	position: FixedIncomePosition,
	uniqueSuffix: string
): string {
	const indexer = {
		PERCENT_CDI: 'CDI',
		CDI_PLUS: 'SELIC',
		PREFIXED: 'PRE',
		IPCA_PLUS: 'IPCA',
	}[position.indexer];
	const maturity = position.maturityDate
		? position.maturityDate.slice(0, 7).replace('-', '')
		: 'LIQ';
	return `RF-${position.kind}-${indexer}-${maturity}-${uniqueSuffix}`.toUpperCase();
}
