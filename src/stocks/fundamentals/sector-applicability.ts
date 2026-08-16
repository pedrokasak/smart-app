import { FundamentalKey } from './fundamentals.types';

const BANK_SECTORS: readonly string[] = ['INTERMEDIARIOS FINANCEIROS'];

const NOT_APPLICABLE_FOR_BANKS: readonly FundamentalKey[] = [
	'roic',
	'netMargin',
	'netDebt',
];

export function normalizeSector(sector: string | null): string | null {
	if (!sector) return null;
	const normalized = sector
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase();
	return normalized || null;
}

export function isApplicable(
	sector: string | null,
	key: FundamentalKey,
): boolean {
	const normalized = normalizeSector(sector);
	if (!normalized) return true;
	if (!BANK_SECTORS.includes(normalized)) return true;
	return !NOT_APPLICABLE_FOR_BANKS.includes(key);
}
