// O plano atual do brapi serve apenas estes ranges. Confirmado contra a API:
// qualquer outro devolve {"code":"INVALID_RANGE"}.
export const DEFAULT_BRAPI_RANGES: readonly string[] = [
	'1d',
	'5d',
	'1mo',
	'3mo',
];

export function parseSupportedRanges(raw?: string): string[] {
	const parsed = (raw ?? '')
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);

	return parsed.length > 0 ? parsed : [...DEFAULT_BRAPI_RANGES];
}

// Lido a cada chamada, e não no import: contratar o plano pago deve ser
// uma mudança de env + redeploy, sem PR.
export function isRangeSupportedByBrapi(range: string | undefined): boolean {
	if (!range) return true;

	const supported = parseSupportedRanges(process.env.BRAPI_SUPPORTED_RANGES);
	return supported.includes(range.trim().toLowerCase());
}
