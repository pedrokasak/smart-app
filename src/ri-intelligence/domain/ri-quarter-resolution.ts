import { RiDocumentRecord } from 'src/ri-intelligence/domain/ri-document.types';

export interface RiQuarterRef {
	year: number;
	quarter: 1 | 2 | 3 | 4;
}

function parseYear(raw: string): number | null {
	const digits = String(raw || '').trim();
	if (!digits) return null;
	if (digits.length === 4) {
		const fullYear = Number(digits);
		return Number.isFinite(fullYear) ? fullYear : null;
	}
	if (digits.length === 2) {
		const shortYear = Number(digits);
		if (!Number.isFinite(shortYear)) return null;
		return 2000 + shortYear;
	}
	return null;
}

function parseQuarterFromText(text: string): RiQuarterRef | null {
	const normalized = String(text || '').toUpperCase();
	if (!normalized) return null;

	const patterns: RegExp[] = [
		/\b([1-4])\s*[TQ]\s*(\d{2}|\d{4})\b/,
		/\b(\d{2}|\d{4})\s*[TQ]\s*([1-4])\b/,
		/\b([1-4])\s*TRI\s*(\d{2}|\d{4})\b/,
	];

	for (const pattern of patterns) {
		const match = normalized.match(pattern);
		if (!match) continue;

		const first = match[1];
		const second = match[2];
		const firstAsQuarter = Number(first);
		const secondAsQuarter = Number(second);

		if (firstAsQuarter >= 1 && firstAsQuarter <= 4) {
			const year = parseYear(second);
			if (!year) continue;
			return {
				year,
				quarter: firstAsQuarter as RiQuarterRef['quarter'],
			};
		}
		if (secondAsQuarter >= 1 && secondAsQuarter <= 4) {
			const year = parseYear(first);
			if (!year) continue;
			return {
				year,
				quarter: secondAsQuarter as RiQuarterRef['quarter'],
			};
		}
	}

	return null;
}

export function inferQuarterFromDocument(
	document: Pick<RiDocumentRecord, 'period' | 'title' | 'source'>
): RiQuarterRef | null {
	const fromPeriod = parseQuarterFromText(document.period || '');
	if (fromPeriod) return fromPeriod;

	const fromTitle = parseQuarterFromText(document.title || '');
	if (fromTitle) return fromTitle;

	const fromUrl = parseQuarterFromText(document.source?.value || '');
	if (fromUrl) return fromUrl;

	return null;
}

export function resolveExpectedReportingQuarter(referenceDate: Date): RiQuarterRef {
	const year = referenceDate.getUTCFullYear();
	const month = referenceDate.getUTCMonth() + 1;
	const currentQuarter = Math.ceil(month / 3);

	if (currentQuarter === 1) {
		return { year: year - 1, quarter: 4 };
	}

	return {
		year,
		quarter: (currentQuarter - 1) as RiQuarterRef['quarter'],
	};
}

export function previousQuarter(ref: RiQuarterRef): RiQuarterRef {
	if (ref.quarter === 1) return { year: ref.year - 1, quarter: 4 };
	return {
		year: ref.year,
		quarter: (ref.quarter - 1) as RiQuarterRef['quarter'],
	};
}

export function sameQuarter(a: RiQuarterRef | null, b: RiQuarterRef | null): boolean {
	if (!a || !b) return false;
	return a.year === b.year && a.quarter === b.quarter;
}

export function toQuarterLabel(ref: RiQuarterRef | null): string | null {
	if (!ref) return null;
	return `${ref.quarter}T${String(ref.year).slice(-2)}`;
}
